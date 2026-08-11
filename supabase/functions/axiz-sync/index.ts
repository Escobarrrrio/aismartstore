import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAuthContext } from "../_shared/auth-guard.ts";
import { withRetry } from "../_shared/retry.ts";


// =====================================================================
// Axiz catalog sync -- v3 INCREMENTAL
// - Writes each fetched page to DB immediately (progress survives kills)
// - Cursor in store_settings: each run resumes where the last stopped
// - Max 8 pages (~8000 items) per invocation: always finishes in time
// - Trigger repeatedly (or via cron) until status shows catalog_complete
// =====================================================================

import { resolveStall, willReachLimit, type StallState } from "./stall.ts";
import { partitionByGate } from "./gate.ts";
import { markupFor, sellingPriceFor } from "./markup.ts";

const AXIZ_TOKEN_URL = "https://identity.goaxiz.co.za/connect/token";
const AXIZ_API_BASE = "https://api.goaxiz.co.za";
const PAGE_SIZE = 1000;
// 8 pages/run was overrunning the gateway timeout (15x 504 in 24h). Fewer pages
// plus the wall-clock budget below means every run finishes and saves its cursor.
const PAGES_PER_RUN = 4;
// 500-row upserts were exceeding the statement timeout: 121 of 194 runs over two
// days ended "partial" with "canceling statement due to statement timeout", and
// because a failed batch was simply skipped while the page cursor still advanced,
// those product updates were silently lost until the cursor wrapped the whole
// catalogue again. `products` carries several indexes plus the category-classifier
// and image-blocklist triggers, so each row costs more than the original size
// assumed. 150 still timed out in production; 75 keeps each statement well inside
// the limit (the split-on-timeout retry below covers the remaining outliers).
const UPSERT_BATCH_SIZE = 75;
/** Don't subdivide below this — past it the timeout isn't about batch size. */
const MIN_UPSERT_BATCH_SIZE = 20;
const AXIZ_REQUEST_TIMEOUT_MS = 20_000;
/** Wall-clock budget for one invocation, comfortably under the gateway timeout. */
const RUN_BUDGET_MS = 110_000;

class AxizUpstreamError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AxizUpstreamError";
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function compactResponse(text: string): string {
  return text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
}

async function fetchAxiz(url: string, init: RequestInit, label: string): Promise<Response> {
  return withRetry(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AXIZ_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (!response.ok) {
        const detail = compactResponse(await response.text());
        const error = new AxizUpstreamError(
          `${label} returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
          response.status,
        );
        if (isRetryableStatus(response.status)) throw error;
        throw Object.assign(error, { terminal: true });
      }
      return response;
    } catch (error) {
      if ((error as { terminal?: boolean }).terminal) throw error;
      if (error instanceof AxizUpstreamError) throw error;
      const message = error instanceof DOMException && error.name === "AbortError"
        ? `${label} timed out after ${AXIZ_REQUEST_TIMEOUT_MS / 1000}s`
        : `${label} network error: ${(error as Error).message}`;
      throw new AxizUpstreamError(message, 503);
    } finally {
      clearTimeout(timeout);
    }
  }, {
    retries: 4,
    baseDelayMs: 750,
    maxDelayMs: 6_000,
    shouldRetry: (error) => !(error as { terminal?: boolean }).terminal,
    onRetry: (attempt, error, delayMs) => {
      console.warn(`[axiz-sync] ${label} retry ${attempt} in ${delayMs}ms: ${(error as Error).message}`);
    },
  });
}

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

async function getSetting(supabase: any, key: string): Promise<string> {
  const { data } = await supabase.from("store_settings").select("value").eq("key", key).maybeSingle();
  return ((data?.value as string) ?? "").trim();
}

async function getAxizToken(clientId: string, clientSecret: string, scope: string): Promise<string> {
  const res = await fetchAxiz(AXIZ_TOKEN_URL, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials", scope }),
  }, "Axiz identity service");
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
    // store_settings (the admin's Credential vault) first, falling back to
    // a Deno.env secret only if the vault has nothing set.
    //
    // This used to be the other way around, and that was a real bug, not
    // just a style choice: this project inherited whatever Deno secrets the
    // old Lovable-managed environment had set, and if AXIZ_CLIENT_ID/SECRET
    // were ever set there (even to a placeholder, or credentials for a
    // different Axiz account), an admin pasting fresh, correct values into
    // Settings would have them saved to store_settings but NEVER READ --
    // this function would keep authenticating with the stale env value on
    // every run, silently, with no way for the admin to tell from the UI
    // that their input was being ignored. "invalid_client" after pasting
    // credentials copied directly off Axiz's own site is exactly the
    // symptom that produces. The vault is the only credential surface the
    // admin can actually see and edit, so it has to be the one that wins.
    const clientId = (await getSetting(supabase, "axiz_client_id")) || Deno.env.get("AXIZ_CLIENT_ID") || "";
    const clientSecret = (await getSetting(supabase, "axiz_client_secret")) || Deno.env.get("AXIZ_CLIENT_SECRET") || "";
    const scope = (await getSetting(supabase, "axiz_scope")) || Deno.env.get("AXIZ_SCOPE") || "";
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
      .in("key", ["axiz_markup_pct", "axiz_markets", "axiz_brand_filter", "axiz_sync_cursor", "axiz_sync_stall", "min_sellable_price"]);
    const settings = Object.fromEntries((settingsRows || []).map((r) => [r.key, r.value]));

    // Load blocked placeholder image URLs so we never publish products that use them.
    const { data: blockRows } = await supabase.from("image_blocklist").select("url");
    const blockedImages = new Set<string>((blockRows ?? []).map((r: any) => r.url));

    const markupPct = Number(settings.axiz_markup_pct || "17");

    // Margin by category, not one number for the whole catalogue. 17% on a
    // R200 cable is R34 -- a card fee and a courier bag eat it -- while 17% on
    // a R35,000 workstation is R5,950 on a line where the market pays single
    // digits. Loaded once per run: it is a handful of rows, and the alternative
    // is a database round trip per product.
    const { data: markupRows } = await supabase
      .from("category_markup")
      .select("category, percent");
    const markupRules: Array<{ category: string | null; percent: number }> =
      (markupRows ?? []).map((r: any) => ({ category: r.category, percent: Number(r.percent) }));
    // The store-wide setting stays the fallback when no rule table exists yet,
    // so a sync running against a database without this migration prices
    // exactly as it did before rather than defaulting everything to 17%.
    if (!markupRules.some((r) => r.category == null)) {
      markupRules.push({ category: null, percent: markupPct });
    }
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
    /** Rows the distributor returned that are not worth storing. See gate.ts. */
    let skippedUnpublishable = 0;
    let pagesDone = 0;
    let catalogComplete = false;
    let deferredReason: string | null = null;
    const runStartedAt = Date.now();
    const notes: string[] = [];

    while (pagesDone < PAGES_PER_RUN) {
      // Stop well before the gateway's own timeout so the cursor is always
      // persisted and the work done so far isn't thrown away.
      if (Date.now() - runStartedAt > RUN_BUDGET_MS) {
        notes.push("run time budget reached; resuming from cursor next invocation");
        break;
      }

      const market = markets[mIdx];
      let res: Response;
      try {
        res = await fetchAxiz(`${AXIZ_API_BASE}/api/services/app/PriceList/SearchPriceList`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ maxResultCount: PAGE_SIZE, pageIndex: pIdx, market, brandFilter }),
        }, `Axiz catalogue market ${market} page ${pIdx}`);
      } catch (err) {
        const message = (err as Error).message;
        notes.push(`market ${market} page ${pIdx}: ${message}`);
        if ((err as { terminal?: boolean }).terminal) {
          // A permanent problem on this market (bad filter, 404, 403) must not
          // block every later market: skip it and keep syncing the rest.
          pagesDone++;
          mIdx++; pIdx = 0;
          if (mIdx >= markets.length) { catalogComplete = true; break; }
          continue;
        }
        // Transient outage: end the run here, leaving the cursor on this page.
        deferredReason = message;
        break;
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
          const effectiveMarkup = markupFor(item.productCategory, markupRules);
          const sellingPrice = sellingPriceFor(cost, effectiveMarkup);
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

        // Only rows that can actually be shown are written. See gate.ts --
        // storing the ~172,000 unpublishable SKUs was 406MB of a 456MB
        // database describing products no shopper can reach, and the
        // distributor is re-read every 15 minutes so nothing is lost by
        // leaving them out.
        const { store: storable, deactivate } = partitionByGate(rows, minSellablePrice);
        skippedUnpublishable += deactivate.length;

        // A SKU that is live today and fails the gate today must come DOWN,
        // not merely be skipped -- otherwise it sits on the storefront
        // forever with stale data. `update` touches only rows that already
        // exist, so this can never reintroduce what the gate just excluded.
        if (deactivate.length > 0) {
          for (const skuBatch of chunk(deactivate, UPSERT_BATCH_SIZE)) {
            const { error: dErr } = await supabase
              .from("products")
              .update({ is_active: false, last_synced_at: now })
              .in("sku", skuBatch)
              .eq("is_active", true);
            if (dErr) notes.push(`deactivate(${skuBatch.length}): ${dErr.message}`);
          }
        }

        for (const batch of chunk(storable, UPSERT_BATCH_SIZE)) {
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
              // The markup actually applied to THIS product, not the
              // store-wide default -- otherwise every cost row claims a margin
              // the product was never priced at.
              margin_percentage: markupFor(src.category, markupRules),
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
    const naturalCursor = catalogComplete ? "0:0" : `${mIdx}:${pIdx}`;

    // Guard against deferring forever on a page that will not load. See
    // stall.ts -- this exact loop froze the whole catalogue for twenty-two
    // hours while every run reported the healthy-looking status "deferred".
    let priorStall: StallState | null = null;
    try {
      priorStall = settings.axiz_sync_stall ? JSON.parse(settings.axiz_sync_stall) : null;
    } catch { /* a corrupt counter must not stop the sync; start it over */ }

    // Before stepping over a page, establish which failure this actually is.
    //
    // Production settled the question the hard way: page 1 timed out for a
    // day, the cursor was moved past it by hand, and page 2 timed out
    // identically. Skipping is the right answer for one unreadable page and
    // the wrong one during an outage, where it would walk the cursor through
    // the whole catalogue syncing nothing.
    //
    // Page 0 of the first market is the control. One extra request, spent only
    // on the run where the answer changes what happens next.
    let probeSucceeded: boolean | null = null;
    if (deferredReason && willReachLimit(cursorRaw, priorStall)) {
      try {
        await fetchAxiz(`${AXIZ_API_BASE}/api/services/app/PriceList/SearchPriceList`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ maxResultCount: 1, pageIndex: 0, market: markets[0], brandFilter }),
        }, "Axiz availability probe");
        probeSucceeded = true;
      } catch {
        probeSucceeded = false;
      }
    }

    const decision = resolveStall({
      cursorBefore: cursorRaw,
      cursorAfter: naturalCursor,
      deferred: Boolean(deferredReason),
      itemsSynced: totalSynced,
      stall: priorStall,
      probeSucceeded,
    });
    const nextCursor = decision.cursor;
    if (decision.note) notes.push(decision.note);

    await supabase.from("store_settings").upsert([
      { key: "axiz_sync_cursor", value: nextCursor, updated_at: new Date().toISOString() },
      {
        key: "axiz_sync_stall",
        value: decision.stall ? JSON.stringify(decision.stall) : "",
        updated_at: new Date().toISOString(),
      },
    ], { onConflict: "key" });

    if (decision.skipped) {
      // Recorded as an error even though the sync recovered on its own: a page
      // the distributor cannot serve is a real problem, and the automatic
      // workaround is precisely why nobody would otherwise hear about it.
      await supabase.from("automation_events").insert({
        source: "axiz-sync",
        event_type: "sync.page_skipped",
        status: "error",
        error_message: decision.note,
        payload: { skipped_cursor: cursorRaw, resumed_at: nextCursor, reason: deferredReason },
      });
    }

    const summary = `v3 | ${catalogComplete ? "catalog_complete" : `in_progress, next cursor ${nextCursor}`}${deferredReason ? ` | deferred: ${deferredReason}` : ""} | AI-flagged this run: ${aiFlagged} | withheld (below R${minSellablePrice}): ${underpriced} | not stored (unpublishable): ${skippedUnpublishable}${notes.length ? " | " + notes.join("; ") : ""}`;
    await supabase.from("sync_logs").update({
      status: deferredReason ? "deferred" : (totalFailed === 0 && notes.length === 0 ? "success" : "partial"),
      items_synced: totalSynced,
      items_failed: totalFailed,
      error_details: summary,
      completed_at: new Date().toISOString(),
    }).eq("id", logRow.id);

    return new Response(JSON.stringify({ status: "completed", version: "v3", synced: totalSynced, failed: totalFailed, aiFlagged, underpriced, skippedUnpublishable, catalogComplete, nextCursor }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    const upstreamError = e instanceof AxizUpstreamError && isRetryableStatus(e.status);
    const message = (e as Error).message;
    await supabase.from("sync_logs").update({
      // A distributor outage is deferred work, not a failed catalogue write.
      // Keep the cursor untouched so the exact same page resumes next run.
      status: upstreamError ? "deferred" : "error",
      error_details: `v3: ${upstreamError ? "Axiz temporarily unavailable; cursor preserved" : message}`,
      completed_at: new Date().toISOString(),
    }).eq("id", logRow.id);
    return new Response(JSON.stringify({
      status: upstreamError ? "deferred" : "error",
      retryable: upstreamError,
      message: upstreamError ? "Axiz is temporarily unavailable. Sync will resume automatically." : message,
    }), {
      // Scheduled invocations should not be marked failed for a recoverable
      // third-party outage; monitoring still sees the deferred sync_log row.
      status: upstreamError ? 200 : 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
