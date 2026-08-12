// Same-origin proxy for the public product search feed, mirroring the
// api/track.ts pattern: the real logic (search_products, rate limiting via
// the shared token-bucket guard) lives in the Supabase edge function
// public-products-api; this route exists so third-party agents and
// comparison tools can call aismartstore.co.za/api/products directly
// instead of needing to know a *.supabase.co function URL, and so the
// existing CSP (`connect-src 'self'`) doesn't have to be loosened for them.
//
// GET /api/products?q=...&category=...&audience=residential|business|all
//   &brand=...&aiOnly=true&inStockOnly=true&minPrice=...&maxPrice=...
//   &sort=relevance|price_asc|price_desc|newest&page=0&pageSize=24
//
// This is a pure passthrough -- no logic duplicated here on purpose. The
// edge function is the single source of truth for what's public-safe to
// return (see its own header comment on what it deliberately never selects).
export const config = { runtime: "edge" };

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

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
  const target = new URL(`${SUPABASE_URL}/functions/v1/public-products-api`);
  target.search = incoming.search;

  const upstream = await fetch(target, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      // The edge function buckets its rate limit on the last x-forwarded-for
      // entry (see guardrails.ts callerKey). Vercel's edge already stamps
      // this with the real client IP appended -- forward it as-is so the
      // limiter buckets on the actual caller, not on Vercel's own egress IP.
      "x-forwarded-for": req.headers.get("x-forwarded-for") ?? "",
    },
  });

  // Passthrough body + status + the headers a caller actually needs
  // (content-type, cache, rate-limit retry hint); Supabase's own
  // connection-level headers aren't meaningful replayed from a different origin.
  const headers = new Headers({ "Content-Type": upstream.headers.get("content-type") ?? "application/json" });
  const cacheControl = upstream.headers.get("cache-control");
  if (cacheControl) headers.set("Cache-Control", cacheControl);
  const retryAfter = upstream.headers.get("retry-after");
  if (retryAfter) headers.set("Retry-After", retryAfter);

  return new Response(upstream.body, { status: upstream.status, headers });
}
