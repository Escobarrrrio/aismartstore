import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2/cors";
import { guard, callerKey } from "../_shared/guardrails.ts";

/**
 * The "dedicated feed" llms-full.txt has been promising since it was
 * written: `GET /api/products` and `GET /api/products/{id}` as real JSON,
 * for shopping agents and comparison tools that don't want to scrape
 * rendered HTML. This function is the actual data source; the same-origin
 * `/api/products*` routes on Vercel (api/products.ts, api/products/[id].ts)
 * are thin proxies in front of it, same pattern as api/track.ts in front of
 * track-pageview.
 *
 * Deliberately public and unauthenticated (`verify_jwt = false` in
 * config.toml) -- an agent evaluating whether this store is worth querying
 * should not need to sign up first. The only thing standing between this
 * and being scraped raw is the same token-bucket guard() used everywhere
 * else real spend/load is at stake (see guardrails.ts): a generous burst
 * for a legitimate agent doing a handful of lookups, throttled hard for
 * anything trying to pull the whole catalogue in a loop.
 *
 * What this must NOT leak: `products.specifications` carries internal
 * sourcing detail on manually-added rows (supplier, supplier_sku, cost
 * notes -- see the Frontosa laptop rows) and is never selected here. Every
 * query below names its columns explicitly rather than `select('*')`, and
 * both the list and detail paths hard-filter `is_active = true` in code --
 * the "Anyone can view products" RLS policy is `USING (true)`, so it does
 * not do this filtering for us.
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE_URL = "https://aismartstore.co.za";

const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 24;

const PUBLIC_COLUMNS =
  "id, sku, slug, name, description, price, category, brand, stock_quantity, in_stock, images, is_ai_product, audience";

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extraHeaders },
  });
}

// deno-lint-ignore no-explicit-any
export function toPublicShape(row: any) {
  return {
    id: row.id,
    sku: row.sku,
    slug: row.slug,
    name: row.name,
    description: row.description,
    brand: row.brand,
    category: row.category,
    price: row.price,
    currency: "ZAR",
    inStock: row.in_stock,
    stockQuantity: row.stock_quantity,
    isAiProduct: row.is_ai_product,
    audience: row.audience,
    images: row.images ?? [],
    url: `${SITE_URL}/product/${row.id}`,
  };
}

export function parseBool(v: string | null): boolean {
  return v === "true" || v === "1";
}

export function parseNumber(v: string | null): number | null {
  if (v === null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Clamp a requested page size into (0, MAX_PAGE_SIZE], defaulting when unset/invalid. */
export function clampPageSize(v: number | null): number {
  const n = v ?? DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(Math.trunc(n), 1), MAX_PAGE_SIZE);
}

export function clampPage(v: number | null): number {
  return Math.max(Math.trunc(v ?? 0), 0);
}

export const VALID_SORTS = ["relevance", "price_asc", "price_desc", "newest"] as const;
export const VALID_AUDIENCES = ["residential", "business", "all"] as const;

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "GET") {
    return json({ error: "method_not_allowed", message: "Only GET is supported." }, 405);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  // One bucket per caller IP. 30 requests back-to-back, refilling at 20/min
  // sustained -- comfortably enough for an agent doing real lookups, not
  // enough to page through the whole catalogue in a tight loop.
  const gate = await guard(admin, {
    provider: "public_products_api",
    bucket: `public-products-api:${callerKey(req)}`,
    capacity: 30,
    refillPerMin: 20,
    source: "public-products-api",
  });
  if (!gate.ok) return gate.response!;

  const url = new URL(req.url);
  const params = url.searchParams;

  // Detail mode: ?id=<uuid> or ?sku=<sku>. Either one returns a single
  // product instead of a search page.
  const idParam = params.get("id");
  const skuParam = params.get("sku");
  if (idParam || skuParam) {
    let query = admin.from("products").select(PUBLIC_COLUMNS).eq("is_active", true);
    query = idParam ? query.eq("id", idParam) : query.eq("sku", skuParam!);
    const { data, error } = await query.maybeSingle();

    if (error) {
      console.error("[public-products-api] detail lookup failed", { error: error.message });
      return json({ error: "internal_error" }, 500);
    }
    if (!data) return json({ error: "not_found", message: "No active product matches that id/sku." }, 404);
    return json(toPublicShape(data), 200, { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" });
  }

  // Search/list mode -- mirrors the same search_products RPC the storefront
  // itself calls, so results here are exactly what a shopper would see.
  const pageSize = clampPageSize(parseNumber(params.get("pageSize")));
  const page = clampPage(parseNumber(params.get("page")));

  const sort = params.get("sort") ?? "relevance";
  if (!VALID_SORTS.includes(sort as typeof VALID_SORTS[number])) {
    return json({ error: "invalid_param", message: `sort must be one of ${VALID_SORTS.join(", ")}.` }, 400);
  }

  const requestedAudience = (params.get("audience") ?? "residential").toLowerCase();
  if (!VALID_AUDIENCES.includes(requestedAudience as typeof VALID_AUDIENCES[number])) {
    return json({ error: "invalid_param", message: `audience must be one of ${VALID_AUDIENCES.join(", ")}.` }, 400);
  }
  // This feed is unauthenticated and runs with the service role, so RLS cannot
  // protect it. B2B SKUs are reserved for signed-in buyers: clamp anything
  // other than "residential" back down instead of erroring, so agents and
  // crawlers still get a useful (consumer-only) response.
  const audience = "residential";



  const { data, error } = await admin.rpc("search_products", {
    search_query: params.get("q") ?? "",
    filter_category: params.get("category"),
    filter_brand: params.get("brand"),
    filter_ai_only: parseBool(params.get("aiOnly")),
    filter_in_stock_only: parseBool(params.get("inStockOnly")),
    min_price: parseNumber(params.get("minPrice")),
    max_price: parseNumber(params.get("maxPrice")),
    sort_by: sort,
    page_number: page,
    page_size: pageSize,
    filter_audience: audience,
  });

  if (error) {
    console.error("[public-products-api] search_products failed", { error: error.message });
    return json({ error: "internal_error" }, 500);
  }

  const rows = data ?? [];
  const total = rows.length > 0 ? Number(rows[0].total_count) : 0;

  return json(
    {
      results: rows.map(toPublicShape),
      pagination: {
        page,
        pageSize,
        total,
        hasMore: (page + 1) * pageSize < total,
      },
    },
    200,
    { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" },
  );
}

// Guarded the same way every other function in this repo guards it (see
// sync-courier-tracking/index.ts): importing this module for its pure
// helpers (index.test.ts) must not also stand up an HTTP listener.
if (import.meta.main) Deno.serve(handler);
