import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAuthContext } from "../_shared/auth-guard.ts";


// =====================================================================
// Axiz catalog sync -- v3 INCREMENTAL
// - Writes each fetched page to DB immediately (progress survives kills)
// - Cursor in store_settings: each run resumes where the last stopped
// - Max 8 pages (~8000 items) per invocation: always finishes in time
// - Trigger repeatedly (or via cron) until status shows catalog_complete
// =====================================================================

const AXIZ_TOKEN_URL = "https://identity.goaxiz.co.za/connect/token";
const AXIZ_API_BASE = "https://api.goaxiz.co.za";
const PAGE_SIZE = 1000;
const PAGES_PER_RUN = 8;
// 500-row upserts were exceeding the statement timeout: 121 of 194 runs over two
// days ended "partial" with "canceling statement due to statement timeout", and
// because a failed batch was simply skipped while the page cursor still advanced,
// those product updates were silently lost until the cursor wrapped the whole
// catalogue again. `products` carries several indexes plus the category-classifier
// and image-blocklist triggers, so each row costs more than the original size
// assumed.
const UPSERT_BATCH_SIZE = 150;
/** Don't subdivide below this — past it the timeout isn't about batch size. */
const MIN_UPSERT_BATCH_SIZE = 20;

function isAiRelated(s: string): boolean {
  if (/\bAI\b/i.test(s)) return true;
  if (/artificial intelligence/i.test(s)) return true;
  if (/\b(machine learning|neural|edge ai|genai|deep learning)\b/i.test(s)) return true;
  if (/\b(copilot|co-pilot|NPU|smart camera|ai speaker|smart home|smart speaker|smart display|smart hub|voice assistant|alexa|google assistant)\b/i.test(s)) return true;
  if (/\b(GPU|GPGPU|accelerat|inference|tensor|CUDA|ROCm|NVIDIA|GeForce|Quadro|RTX|Radeon\s*Pro)\b/i.test(s)) return true;
  if (/\b(workstation|data\s*cent|HPC|compute\s*node|rack\s*server)\b/i.test(s)) return true;
  return false;
}

function slugify(name: string, sku: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return `${base}-${sku.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`.slice(0, 120);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function getAxizToken(clientId: string, clientSecret: string, scope: string): Promise<string> {
  const res = await fetch(AXIZ_TOKEN_URL, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials", scope }),
  });
  if (!res.ok) throw new Error(`Axiz token failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  if (!data.access_token) throw new Error("No access_token in Axiz response");
  return data.access_token as string;
}

Deno.serve(async (req) => {
  // SECURITY: only admins or the internal cron caller may trigger the sync.
  // Accepts either a pre-shared secret header OR the service-role bearer
  // token pg_cron actually sends (see the axiz-sync cron job definition) --
  // this was previously missing the Bearer branch entirely, so every
  // cron-triggered run was falling through to the admin-JWT check and
  // getting rejected with 403 (there's no user session on a cron call).
  const internalSecret = Deno.env.get("INTERNAL_CRON_SECRET") ?? "";
  const providedSecret = req.headers.get("x-internal-secret") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authHeader = req.headers.get("Authorization") ?? "";
  const isInternal =
    (internalSecret.length > 0 && providedSecret === internalSecret) ||
    (serviceRoleKey.length > 0 && authHeader === `Bearer ${serviceRoleKey}`);
  if (!isInternal) {
    const auth = await getAuthContext(req);
    if (!auth.userId || !auth.isAdmin) {
      return new Response(JSON.stringify({ error: "Admin role required" }), {
        status: 403, headers: { "Content-Type": "application/json" },
      });
    }
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: logRow } = await supabase
    .from("sync_logs")
    .insert({ source: "axiz", status: "running", started_at: new Date().toISOString() })
    .select()
    .single();

  try {
    const clientId = Deno.env.get("AXIZ_CLIENT_ID");
    const clientSecret = Deno.env.get("AXIZ_CLIENT_SECRET");
    const scope = Deno.env.get("AXIZ_SCOPE");
    if (!clientId || !clientSecret || !scope) {
      await supabase.from("sync_logs").update({
        status: "skipped",
        error_details: "v3: AXIZ secrets not set",
        completed_at: new Date().toISOString(),
      }).eq("id", logRow.id);
      return new Response(JSON.stringify({ status: "skipped" }), { headers: { "Content-Type": "application/json" } });
    }

    const { data: settingsRows } = await supabase
      .from("store_settings")
      .select("key, value")
      .in("key", ["axiz_markup_pct", "axiz_markets", "axiz_brand_filter", "axiz_sync_cursor", "min_sellable_price"]);
    const settings = Object.fromEntries((settingsRows || []).map((r) => [r.key, r.value]));

    // Load blocked placeholder image URLs so we never publish products that use them.
    const { data: blockRows } = await supabase.from("image_blocklist").select("url");
    const blockedImages = new Set<string>((blockRows ?? []).map((r: any) => r.url));

    const markupPct = Number(settings.axiz_markup_pct || "17");
    // Floor below which a distributor line is treated as a feed artefact rather
    // than a sellable product. Axiz ships licence/registration "Trk" SKUs
    // alongside real stock -- they carried names like "HPE Alletra 6010 AF DC
    // TR Base Array" at a cost of ~R25, which published a six-figure storage
    // array to the consumer storefront with a working Add-to-cart button.
    const minSellablePrice = Number(settings.min_sellable_price || "50");
    const markets = (settings.axiz_markets || "14").split(",").map((m) => Number(m.trim())).filter((n) => !isNaN(n));
    const brandFilter = (settings.axiz_brand_filter || "").split(",").filter(Boolean).map((b) => Number(b.trim()));

    // Normalize image URLs (http -> https, drop empties/dupes)
    const normalizeImages = (raw: unknown): string[] => {
      const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
      const out = new Set<string>();
      for (const v of arr) {
        if (typeof v !== "string") continue;
        const s = v.trim();
        if (!s) continue;
        const url = s.startsWith("http://") ? "https://" + s.slice(7) : s;
        if (blockedImages.has(url)) continue;
        if (/\/axd-live\/[^/]+\.(jpg|png)$/i.test(url)) continue; // brand-logo placeholders
        out.add(url);
      }
      return [...out];
    };

    // Cursor format: "marketIndex:pageIndex"
    const cursorRaw = settings.axiz_sync_cursor || "0:0";
    let [mIdx, pIdx] = cursorRaw.split(":").map((n: string) => Number(n) || 0);
    if (mIdx >= markets.length) { mIdx = 0; pIdx = 0; }

    const accessToken = await getAxizToken(clientId, clientSecret, scope);

    let totalSynced = 0;
    let totalFailed = 0;
    let aiFlagged = 0;
    // Distributor lines withheld for being priced below the sellable floor.
    let underpriced = 0;
    let pagesDone = 0;
    let catalogComplete = false;
    const notes: string[] = [];

    while (pagesDone < PAGES_PER_RUN) {
      const market = markets[mIdx];
      const res = await fetch(`${AXIZ_API_BASE}/api/services/app/PriceList/SearchPriceList`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ maxResultCount: PAGE_SIZE, pageIndex: pIdx, market, brandFilter }),
      });

      if (!res.ok) {
        notes.push(`market ${market} page ${pIdx}: HTTP ${res.status} -- skipping market`);
        mIdx++; pIdx = 0;
        if (mIdx >= markets.length) { catalogComplete = true; break; }
        continue;
      }

      const data = await res.json();
      const pageItems = (data?.result?.items ?? data?.result ?? []).filter((i: any) => i.productCode);

      if (pageItems.length > 0) {
        const now = new Date().toISOString();
        const rows = pageItems.map((item: any) => {
          const name = item.productDescription || String(item.productCode);
          const searchable = `${item.productCategory ?? ""} ${item.brand?.brandName ?? ""} ${name}`;
          const ai = isAiRelated(searchable);
          if (ai) aiFlagged++;
          const cost = Number(item.price ?? 0);
          const sellingPrice = Math.round(cost * (1 + markupPct / 100) * 100) / 100;
          const imgs = normalizeImages(item.imageGallery);
          const publishable = cost > 0 && imgs.length > 0 && sellingPrice >= minSellablePrice;
          if (cost > 0 && imgs.length > 0 && sellingPrice < minSellablePrice) underpriced++;
          // Laptops get a higher residential cutoff than the R15k store-wide
          // default: this distributor's laptop range is almost entirely
          // corporate Dell models (3Y onsite warranties etc.), and today's
          // realistic consumer laptop price floor sits well above R15k --
          // a flat R15k rule was routing nearly the whole category to the
          // Business Portal regardless of whether it's actually enterprise
          // gear. Every other category keeps the original R15k line.
          const isLaptop = /laptop/i.test(item.productCategory ?? "");
          const residentialCutoff = isLaptop ? 25000 : 15000;
          return {
            sku: String(item.productCode),
            slug: slugify(name, String(item.productCode)),
            name,
            description: item.productDescription,
            price: sellingPrice,
            category: item.productCategory,
            brand: item.brand?.brandName,
            // Axiz omits onHand for most SKUs (they ship on order via distributor).
            // Treat "unknown" as available; only mark OoS when the field is explicitly present and 0.
            stock_quantity: item.onHand == null ? null : Number(item.onHand),
            stock_status: item.onHand == null ? "in_stock" : (Number(item.onHand) > 0 ? "in_stock" : "out_of_stock"),
            in_stock: item.onHand == null ? true : Number(item.onHand) > 0,
            images: imgs,
            is_active: publishable,
            is_ai_product: ai,
            audience: sellingPrice <= residentialCutoff ? "residential" : "business",
            last_synced_at: now,
            _cost: cost,
            _axiz_id: String(item.productCode),
          };
        });

        // Write THIS page immediately -- progress persists even if killed.
        /**
         * Upsert a batch, and on a timeout split it in half and retry each side
         * rather than discarding the whole thing. A transient slow statement
         * then costs a little extra latency instead of silently dropping every
         * product in the batch. Returns the rows the database actually wrote.
         */
        const upsertWithSplit = async (
          batch: typeof rows,
        ): Promise<Array<{ id: string; sku: string; price: number }>> => {
          const productRows = batch.map(({ _cost, _axiz_id, ...r }) => r);
          const { data, error } = await supabase
            .from("products")
            .upsert(productRows, { onConflict: "sku" })
            .select("id, sku, price");

          if (!error) return (data ?? []) as Array<{ id: string; sku: string; price: number }>;

          const isTimeout = /statement timeout|canceling statement/i.test(error.message);
          if (isTimeout && batch.length > MIN_UPSERT_BATCH_SIZE) {
            const mid = Math.ceil(batch.length / 2);
            const left = await upsertWithSplit(batch.slice(0, mid));
            const right = await upsertWithSplit(batch.slice(mid));
            return [...left, ...right];
          }

          totalFailed += batch.length;
          notes.push(`upsert(${batch.length}): ${error.message}`);
          return [];
        };

        for (const batch of chunk(rows, UPSERT_BATCH_SIZE)) {
          const upserted = await upsertWithSplit(batch);
          if (upserted.length === 0) continue;
          totalSynced += upserted.length;

          // Write cost/margin rows keyed by product id. Skip any returned row we
          // can't match back to a source SKU rather than asserting non-null --
          // one unexpected row would otherwise throw and abort the whole page.
          const bySku = new Map(batch.map((b) => [b.sku, b]));
          const costRows = upserted.flatMap((p) => {
            const src = bySku.get(p.sku);
            if (!src) return [];
            return [{
              product_id: p.id,
              cost_price: src._cost,
              selling_price: src.price,
              margin_percentage: markupPct,
              axiz_product_id: src._axiz_id,
              updated_at: now,
            }];
          });
          if (costRows.length) {
            const { error: cErr } = await supabase.from("product_costs").upsert(costRows, { onConflict: "product_id" });
            if (cErr) notes.push(`product_costs: ${cErr.message}`);
          }
        }
      }

      pagesDone++;

      if (pageItems.length < PAGE_SIZE) {
        mIdx++; pIdx = 0;
        if (mIdx >= markets.length) { catalogComplete = true; break; }
      } else {
        pIdx++;
      }
    }

    // Persist cursor for the next invocation.
    const nextCursor = catalogComplete ? "0:0" : `${mIdx}:${pIdx}`;
    await supabase.from("store_settings").upsert(
      { key: "axiz_sync_cursor", value: nextCursor, updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );

    const summary = `v3 | ${catalogComplete ? "catalog_complete" : `in_progress, next cursor ${nextCursor}`} | AI-flagged this run: ${aiFlagged} | withheld (below R${minSellablePrice}): ${underpriced}${notes.length ? " | " + notes.join("; ") : ""}`;
    await supabase.from("sync_logs").update({
      status: totalFailed === 0 ? "success" : "partial",
      items_synced: totalSynced,
      items_failed: totalFailed,
      error_details: summary,
      completed_at: new Date().toISOString(),
    }).eq("id", logRow.id);

    return new Response(JSON.stringify({ status: "completed", version: "v3", synced: totalSynced, failed: totalFailed, aiFlagged, underpriced, catalogComplete, nextCursor }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    await supabase.from("sync_logs").update({
      status: "error",
      error_details: `v3: ${(e as Error).message}`,
      completed_at: new Date().toISOString(),
    }).eq("id", logRow.id);
    return new Response(JSON.stringify({ status: "error", message: (e as Error).message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
