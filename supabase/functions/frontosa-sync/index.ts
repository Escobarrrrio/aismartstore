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
//
// v2: both endpoints return their FULL catalogue in one shot (no paging,
// unlike Axiz) -- but that catalogue is 6,382 items. The first deployed
// version wrote one row at a time (one upsert per catalog item, one SELECT
// then one UPDATE per stock item): 114 seconds and a platform-level 546
// before finishing even a fraction of it, confirmed via a direct pg_net
// probe of Frontosa's own server responding in under 2 seconds -- the
// upstream was never the bottleneck. Rewritten to batch every write, using
// the exact chunk()/upsertWithSplit() pattern already proven in axiz-sync
// against the same "products" table and its indexes/triggers.

const STOCK_INFO_URL = "http://live.frontosacpt.co.za/json/stock_info.asp";
const STOCK_URL = "http://live.frontosacpt.co.za/json/stock.asp";
const REQUEST_TIMEOUT_MS = 20_000;
const SKU_PREFIX = "FR-";

// Same figures as axiz-sync, same table -- see the comment there. 75 keeps
// each upsert statement well inside the timeout; below MIN, a timeout isn't
// about batch size anymore so splitting further just wastes round trips.
const UPSERT_BATCH_SIZE = 75;
const MIN_UPSERT_BATCH_SIZE = 20;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
};

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

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
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
 *  real response doesn't match what was guessed here. Confirmed live
 *  against a real response: both arrays are {id, name}. */
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

/**
 * Upsert a batch, and on a statement timeout split it in half and retry
 * each side rather than discarding the whole thing -- identical strategy
 * to axiz-sync's upsertWithSplit, against the same table.
 */
async function upsertWithSplit(
  supabase: any,
  batch: Record<string, unknown>[],
  notes: string[],
  onFailed: (n: number) => void,
): Promise<Array<{ id: string; sku: string }>> {
  const { data, error } = await supabase.from("products").upsert(batch, { onConflict: "sku" }).select("id, sku");
  if (!error) return (data ?? []) as Array<{ id: string; sku: string }>;

  const isTimeout = /statement timeout|canceling statement/i.test(error.message);
  if (isTimeout && batch.length > MIN_UPSERT_BATCH_SIZE) {
    const mid = Math.ceil(batch.length / 2);
    const left = await upsertWithSplit(supabase, batch.slice(0, mid), notes, onFailed);
    const right = await upsertWithSplit(supabase, batch.slice(mid), notes, onFailed);
    return [...left, ...right];
  }

  onFailed(batch.length);
  notes.push(`upsert(${batch.length}): ${error.message}`);
  return [];
}

const handler = async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

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
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
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

  // store_settings (Credential vault) first -- see axiz-sync's comment on
  // the same precedence bug: a stale Deno secret must never silently
  // override what the admin actually entered in Settings.
  const token = (await getSetting(supabase, "frontosa_token")) || Deno.env.get("FRONTOSA_TOKEN") || "";
  if (!token) {
    const msg = "FRONTOSA_TOKEN not configured (set it in Admin -> Settings -> Credential vault)";
    await finishRun(supabase, run, { status: "failed", items_synced: 0, items_failed: 0, error_details: msg });
    await checkAndAlertOnFailureStreak(supabase, "frontosa-sync").catch(() => {});
    return new Response(JSON.stringify({ error: msg }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
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
        brands?: unknown; categories?: unknown; items?: FrontosaCatalogItem[]; image_base_url?: string;
      }>(`${STOCK_INFO_URL}?token=${encodeURIComponent(token)}`, "Frontosa stock_info");

      const brandLookup = buildLookup(catalog.brands);
      const categoryLookup = buildLookup(catalog.categories);
      const items = Array.isArray(catalog.items) ? catalog.items : [];

      // Frontosa's `images` are paths relative to the feed's own
      // image_base_url ("13234/01.webp"), not absolute URLs -- storing them
      // raw gives every Frontosa product a broken <img>. The base is read
      // from the response rather than hardcoded because the feed publishes
      // it as a field, which means they intend to be able to move it.
      const imageBase = (catalog.image_base_url ?? "").trim();

      const rows: Record<string, unknown>[] = [];
      for (const item of items) {
        if (!item.code) continue;
        const images = (item.images ?? [])
          .filter((u): u is string => typeof u === "string" && u.trim().length > 0)
          .map((u) => (/^https?:\/\//i.test(u) ? u : `${imageBase}${u.trim()}`));
        if (images.length === 0) {
          skippedNoImage++;
          continue;
        }
        const brand = item.bid != null ? (brandLookup.get(String(item.bid)) ?? String(item.bid)) : null;
        const category = item.pid != null ? (categoryLookup.get(String(item.pid)) ?? String(item.pid)) : null;
        rows.push({
          sku: `${SKU_PREFIX}${item.code}`,
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
          // pull, not here -- this row may not exist as a real price yet,
          // and upsert only touches the columns listed in each payload, so
          // this batch never clobbers a price/stock value the stock pull
          // already wrote for the same SKU.
        });
      }

      for (const batch of chunk(rows, UPSERT_BATCH_SIZE)) {
        const upserted = await upsertWithSplit(supabase, batch, notes, (n) => { failed += n; });
        synced += upserted.length;
      }
    }

    // Stock pull always runs (both modes) -- it's the one that actually
    // makes a row sellable, and running it every time (not just on catalog
    // days) keeps price/stock current on the hourly schedule.
    const stock = await fetchJson<{ items?: FrontosaStockItem[] }>(
      `${STOCK_URL}?token=${encodeURIComponent(token)}`, "Frontosa stock",
    );
    const stockItems = Array.isArray(stock.items) ? stock.items : [];

    // One bulk read instead of one SELECT per item (6,382 of them) -- name
    // is the only NOT NULL products column without a default, so it's the
    // only field besides category/images this needs to carry through to
    // keep the upsert below valid on its (never-taken) insert branch.
    const { data: existingRows } = await supabase
      .from("products")
      .select("sku, name, category, images")
      .like("sku", `${SKU_PREFIX}%`);
    const existingBySku = new Map<string, { name: string; category: string | null; images: string[] }>(
      (existingRows ?? []).map((r: any) => [r.sku as string, { name: r.name, category: r.category, images: r.images ?? [] }]),
    );

    const stockRows: Record<string, unknown>[] = [];
    // cost/markup carried alongside each row purely to build product_costs
    // after the batch write returns real product ids -- see costsBySku below.
    const costsBySku = new Map<string, { cost: number; sellingPrice: number; markupPct: number; supplierSku: string }>();

    for (const item of stockItems) {
      if (!item.code) continue;
      const sku = `${SKU_PREFIX}${item.code}`;
      const cost = Number(item.price ?? 0);
      if (!(cost > 0)) continue;

      const existing = existingBySku.get(sku);
      if (!existing) {
        // stock.asp mentioned a code the catalogue pull has never seen (or
        // hasn't run yet) -- nothing to attach a price to without a
        // name/image, so it's counted and skipped, not inserted blind.
        skippedNotCataloged++;
        continue;
      }
      if (existing.images.length === 0) {
        skippedNoImage++;
        continue;
      }

      const qty = totalQty(item);
      const markupPct = markupFor(existing.category, markupRules);
      const sellingPrice = sellingPriceFor(cost, markupPct);
      const publishable = sellingPrice >= minSellablePrice;
      // Same split axiz-sync uses: a flat R15k cutoff routes almost the
      // entire laptop range to the business catalogue regardless of price,
      // so laptops get a higher cutoff. Every other category keeps R15k.
      // Without this, `audience` never gets set on the stock pull at all --
      // the column defaults to 'business' on the table, catalog mode never
      // touches it either, and every Frontosa product landed on the
      // consumer storefront's default view invisibly: all 744 active rows
      // sat at audience='business', reachable only via the Business Portal.
      const isLaptop = /laptop/i.test(existing.category ?? "");
      const residentialCutoff = isLaptop ? 25000 : 15000;

      stockRows.push({
        sku,
        name: existing.name,
        // `images` is carried through unchanged, and it is NOT redundant.
        // products_enforce_blocklist is a BEFORE INSERT trigger, and on an
        // upsert Postgres fires BEFORE INSERT on the *proposed* row before
        // it detects the conflict -- so a payload without `images` presents
        // an empty default array, the trigger sets is_active := false, and
        // that trigger-modified row becomes `excluded` for the DO UPDATE.
        // The result was all 745 synced products landing is_active = false
        // with no error anywhere. Sending the real images keeps the
        // trigger's precondition true so it leaves is_active alone.
        images: existing.images,
        price: sellingPrice,
        stock_quantity: qty,
        stock_status: qty > 0 ? "in_stock" : "out_of_stock",
        in_stock: qty > 0,
        is_active: publishable,
        audience: sellingPrice <= residentialCutoff ? "residential" : "business",
        last_synced_at: now,
      });
      costsBySku.set(sku, { cost, sellingPrice, markupPct, supplierSku: item.code });
    }

    for (const batch of chunk(stockRows, UPSERT_BATCH_SIZE)) {
      const upserted = await upsertWithSplit(supabase, batch, notes, (n) => { failed += n; });
      synced += upserted.length;
      if (upserted.length === 0) continue;

      const costRows = upserted.flatMap((p) => {
        const c = costsBySku.get(p.sku);
        if (!c) return [];
        return [{
          product_id: p.id,
          cost_price: c.cost,
          selling_price: c.sellingPrice,
          margin_percentage: c.markupPct,
          // Reusing this column as a generic distributor-SKU field rather
          // than adding a migration for one more text column -- it's not
          // FK'd to anything Axiz-specific, just a label.
          axiz_product_id: c.supplierSku,
          updated_at: now,
        }];
      });
      if (costRows.length) {
        for (const costBatch of chunk(costRows, UPSERT_BATCH_SIZE)) {
          const { error: costErr } = await supabase.from("product_costs").upsert(costBatch, { onConflict: "product_id" });
          if (costErr) notes.push(`product_costs(${costBatch.length}): ${costErr.message}`);
        }
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
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = (e as Error).message;
    await finishRun(supabase, run, { status: "failed", items_synced: 0, items_failed: 1, error_details: message });
    await checkAndAlertOnFailureStreak(supabase, "frontosa-sync").catch(() => {});
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
};

if (import.meta.main) Deno.serve(handler);
