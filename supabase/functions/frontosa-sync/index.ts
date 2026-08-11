import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAuthContext } from "../_shared/auth-guard.ts";
import { withRetry } from "../_shared/retry.ts";
import { startRun, finishRun, deriveRunStatus } from "../_shared/run-log.ts";
import { checkAndAlertOnFailureStreak } from "../_shared/alerts.ts";
import { markupFor, sellingPriceFor, type MarkupRule } from "./markup.ts";

// Frontosa dealer feed sync -- two endpoints, merged by stock code:
//
//   stock_info.asp -- catalogue: description, brand, category, specs,
//   images, barcodes. Updated hourly on Frontosa's side; they recommend
//   pulling it once a day (07:15-08:00). Unlike Axiz's API, this one
//   genuinely ships images per item -- "we currently do not have a full
//   catalog of images but we are growing this slowly over time" per their
//   own docs, so not every item has one yet, but real ones exist.
//
//   stock.asp -- live pricing + per-branch stock. Updated through the day;
//   Frontosa asks for at most one pull an hour, after :10, and the feed is
//   rate-limited on their side. 'price' here is Frontosa's ex-VAT selling
//   price to us as a dealer -- our cost, exactly like Axiz's 'price' field
//   -- so the same category-markup table produces our own selling price.
//
// One function, one `mode` param decides which endpoints it hits:
//   mode=catalog -- both endpoints (full refresh), for the once-daily cron.
//   mode=stock (default) -- stock.asp only, updating price/qty/status on
//     rows the catalog pull already created. Never creates new products by
//     itself -- an item stock.asp mentions that catalog.asp never brought
//     in (imageless, or not synced yet) has nothing to attach a price to.
//
// Same publish gate as axiz-sync: a row needs a real cost and at least one
// image to go live. No image means no listing, not a listing with a
// placeholder -- consistent with why axiz-sync's own gate exists.

const STOCK_INFO_URL = "http://live.frontosacpt.co.za/json/stock_info.asp";
const STOCK_URL = "http://live.frontosacpt.co.za/json/stock.asp";
const REQUEST_TIMEOUT_MS = 25_000;
const SKU_PREFIX = "FR-";

interface FrontosaSpec { n?: string; v?: string }
interface FrontosaBarcode { t?: string; v?: string }
interface FrontosaCatalogItem {
  code?: string;
  desc?: string;
  blurb?: string;
  created?: string;
  status?: string;
  war?: string | number;
  bid?: string | number;
  pid?: string | number;
  url?: string;
  specs?: FrontosaSpec[];
  images?: string[];
  barcodes?: FrontosaBarcode[];
}
interface FrontosaStockItem {
  code?: string;
  price?: number | string;
  [key: string]: unknown; // qty_{branch} / more_{branch} -- branch names aren't known ahead of time
}

async function getSetting(supabase: any, key: string): Promise<string> {
  const { data } = await supabase.from("store_settings").select("value").eq("key", key).maybeSingle();
  return ((data?.value as string) ?? "").trim();
}

async function fetchJson<T>(url: string, label: string): Promise<T> {
  return withRetry(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${label} HTTP ${res.status}`);
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }, { retries: 3, baseDelayMs: 1000, onRetry: (n, e) => console.warn(`[frontosa-sync] ${label} retry ${n}:`, (e as Error).message) });
}

/** Frontosa's docs give the item field names exactly but not the shape of
 *  the brands/categories lookup arrays -- this accepts a few plausible key
 *  names (id/bid/pid, name/desc/title) instead of assuming one, and falls
 *  back to the raw numeric id as the label rather than throwing when a
 *  real response doesn't match what was guessed here. */
function buildLookup(rows: unknown): Map<string, string> {
  const map = new Map<string, string>();
  if (!Array.isArray(rows)) return map;
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const row = r as Record<string, unknown>;
    const id = row.id ?? row.bid ?? row.pid;
    const name = row.name ?? row.desc ?? row.title;
    if (id != null && typeof name === "string" && name.trim()) {
      map.set(String(id), name.trim());
    }
  }
  return map;
}

/** Sums every qty_{branch} field present on a stock.asp row -- branch
 *  names aren't fixed/known ahead of time, so this reads whatever keys
 *  are actually there rather than a hardcoded branch list. */
function totalQty(item: FrontosaStockItem): number {
  let total = 0;
  for (const [key, value] of Object.entries(item)) {
    if (key.startsWith("qty_")) {
      const n = Number(value);
      if (Number.isFinite(n)) total += n;
    }
  }
  return total;
}

const handler = async (req: Request) => {
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
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let mode: "catalog" | "stock" = "stock";
  try {
    const body = await req.json().catch(() => ({}));
    if (body?.mode === "catalog") mode = "catalog";
  } catch { /* no body / not JSON -- default mode stands */ }

  const run = await startRun(supabase, "frontosa-sync");

  const token = Deno.env.get("FRONTOSA_TOKEN") || (await getSetting(supabase, "frontosa_token"));
  if (!token) {
    const msg = "FRONTOSA_TOKEN not configured (set it in Admin -> Settings -> Credential vault)";
    await finishRun(supabase, run, { status: "failed", items_synced: 0, items_failed: 0, error_details: msg });
    await checkAndAlertOnFailureStreak(supabase, "frontosa-sync").catch(() => {});
    return new Response(JSON.stringify({ error: msg }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const { data: markupRows } = await supabase.from("category_markup").select("category, percent");
    const markupRules: MarkupRule[] = (markupRows ?? []).map((r: any) => ({ category: r.category, percent: Number(r.percent) }));
    if (!markupRules.some((r) => r.category == null)) {
      const { data: setting } = await supabase.from("store_settings").select("value").eq("key", "axiz_markup_pct").maybeSingle();
      markupRules.push({ category: null, percent: Number((setting?.value as string) || "17") });
    }
    const { data: minSetting } = await supabase.from("store_settings").select("value").eq("key", "min_sellable_price").maybeSingle();
    const minSellablePrice = Number((minSetting?.value as string) || "50");

    let synced = 0;
    let failed = 0;
    let skippedNoImage = 0;
    let skippedNotCataloged = 0;
    const notes: string[] = [];
    const now = new Date().toISOString();

    if (mode === "catalog") {
      const catalog = await fetchJson<{
        brands?: unknown; categories?: unknown; items?: FrontosaCatalogItem[];
      }>(`${STOCK_INFO_URL}?token=${encodeURIComponent(token)}`, "Frontosa stock_info");

      const brandLookup = buildLookup(catalog.brands);
      const categoryLookup = buildLookup(catalog.categories);
      const items = Array.isArray(catalog.items) ? catalog.items : [];

      for (const item of items) {
        if (!item.code) continue;
        try {
          const images = (item.images ?? []).filter((u): u is string => typeof u === "string" && u.trim().length > 0);
          if (images.length === 0) {
            skippedNoImage++;
            continue;
          }
          const brand = item.bid != null ? (brandLookup.get(String(item.bid)) ?? String(item.bid)) : null;
          const category = item.pid != null ? (categoryLookup.get(String(item.pid)) ?? String(item.pid)) : null;
          const sku = `${SKU_PREFIX}${item.code}`;

          const { error } = await supabase.from("products").upsert({
            sku,
            name: item.desc || item.code,
            description: item.blurb || item.desc || null,
            category,
            brand,
            images,
            specifications: {
              supplier: "Frontosa",
              supplier_sku: item.code,
              supplier_status: item.status ?? null,
              warranty_months: item.war ?? null,
              product_url: item.url ?? null,
              barcodes: (item.barcodes ?? []).map((b) => ({ type: b.t, value: b.v })),
              specs: (item.specs ?? []).map((s) => ({ name: s.n, value: s.v })),
              manually_sourced: false,
            },
            last_synced_at: now,
            // Publishability (is_active) and price are set by the stock
            // pull, not here -- this row may not exist as a real price yet.
          }, { onConflict: "sku" });

          if (error) { failed++; notes.push(`${item.code}: ${error.message}`); }
          else synced++;
        } catch (e) {
          failed++;
          notes.push(`${item.code}: ${(e as Error).message}`);
        }
      }
    }

    // Stock pull always runs (both modes) -- it's the one that actually
    // makes a row sellable, and running it every time (not just on catalog
    // days) keeps price/stock current on the hourly schedule.
    const stock = await fetchJson<{ items?: FrontosaStockItem[] }>(
      `${STOCK_URL}?token=${encodeURIComponent(token)}`, "Frontosa stock",
    );
    const stockItems = Array.isArray(stock.items) ? stock.items : [];

    for (const item of stockItems) {
      if (!item.code) continue;
      try {
        const sku = `${SKU_PREFIX}${item.code}`;
        const cost = Number(item.price ?? 0);
        if (!(cost > 0)) continue;

        const { data: existing } = await supabase
          .from("products").select("id, category, images").eq("sku", sku).maybeSingle();
        if (!existing) {
          // stock.asp mentioned a code the catalogue pull has never seen
          // (or hasn't run yet) -- nothing to attach a price to without a
          // name/image, so it's counted and skipped, not inserted blind.
          skippedNotCataloged++;
          continue;
        }
        if (!Array.isArray(existing.images) || existing.images.length === 0) {
          skippedNoImage++;
          continue;
        }

        const qty = totalQty(item);
        const markupPct = markupFor(existing.category as string | null, markupRules);
        const sellingPrice = sellingPriceFor(cost, markupPct);
        const publishable = sellingPrice >= minSellablePrice;

        const { error } = await supabase.from("products").update({
          price: sellingPrice,
          stock_quantity: qty,
          stock_status: qty > 0 ? "in_stock" : "out_of_stock",
          in_stock: qty > 0,
          is_active: publishable,
          last_synced_at: now,
        }).eq("id", existing.id);
        if (error) { failed++; notes.push(`${item.code}: ${error.message}`); continue; }

        const { error: costErr } = await supabase.from("product_costs").upsert({
          product_id: existing.id,
          cost_price: cost,
          selling_price: sellingPrice,
          margin_percentage: markupPct,
          // Reusing this column as a generic distributor-SKU field rather
          // than adding a migration for one more text column -- it's not
          // FK'd to anything Axiz-specific, just a label.
          axiz_product_id: item.code,
          updated_at: now,
        }, { onConflict: "product_id" });
        if (costErr) notes.push(`product_costs ${item.code}: ${costErr.message}`);

        synced++;
      } catch (e) {
        failed++;
        notes.push(`${item.code}: ${(e as Error).message}`);
      }
    }

    const status = deriveRunStatus(synced, failed);
    const summary = `mode=${mode} | synced ${synced} | skipped (no image): ${skippedNoImage} | skipped (not catalogued yet): ${skippedNotCataloged}${notes.length ? " | " + notes.slice(0, 20).join("; ") : ""}`;
    await finishRun(supabase, run, { status, items_synced: synced, items_failed: failed, error_details: summary });
    if (status === "failed") {
      await checkAndAlertOnFailureStreak(supabase, "frontosa-sync").catch((e) =>
        console.error("[frontosa-sync] alert check failed:", (e as Error).message),
      );
    }

    return new Response(JSON.stringify({ ok: true, mode, synced, failed, skippedNoImage, skippedNotCataloged }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = (e as Error).message;
    await finishRun(supabase, run, { status: "failed", items_synced: 0, items_failed: 1, error_details: message });
    await checkAndAlertOnFailureStreak(supabase, "frontosa-sync").catch(() => {});
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
};

if (import.meta.main) Deno.serve(handler);
