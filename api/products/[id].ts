// Same-origin proxy for single-product lookups, GET /api/products/{idOrSku}.
// Accepts either the product's UUID id or its SKU -- SKUs are what
// schema.org/Product.sku already exposes on every product page (see
// ProductDetail.tsx), so an agent that scraped one from a page can look the
// same item back up here without needing the internal id.
//
// See api/products.ts for why this proxy exists instead of calling the
// Supabase function URL directly.
export const config = { runtime: "edge" };

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return new Response(JSON.stringify({ error: "misconfigured" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  const incoming = new URL(req.url);
  const idOrSku = decodeURIComponent(incoming.pathname.split("/").pop() ?? "");
  if (!idOrSku) {
    return new Response(JSON.stringify({ error: "invalid_param", message: "Missing product id/sku in path." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const target = new URL(`${SUPABASE_URL}/functions/v1/public-products-api`);
  target.searchParams.set(UUID_RE.test(idOrSku) ? "id" : "sku", idOrSku);

  const upstream = await fetch(target, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "x-forwarded-for": req.headers.get("x-forwarded-for") ?? "",
    },
  });

  const headers = new Headers({ "Content-Type": upstream.headers.get("content-type") ?? "application/json" });
  const cacheControl = upstream.headers.get("cache-control");
  if (cacheControl) headers.set("Cache-Control", cacheControl);
  const retryAfter = upstream.headers.get("retry-after");
  if (retryAfter) headers.set("Retry-After", retryAfter);

  return new Response(upstream.body, { status: upstream.status, headers });
}
