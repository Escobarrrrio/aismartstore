// Pageview tracking proxy, running on Vercel's edge network.
//
// The site's own analytics dashboard (Admin -> Analytics) was showing every
// visit as country "Unknown" and city "Unknown". The reason: the browser
// beacon called Supabase's `track-pageview` function directly, which lives
// on a completely different domain (never touches Vercel's edge, so none of
// Vercel's own geo headers exist there) and had to fall back to a keyless
// third-party IP-geolocation API that turned out to be too slow/unreliable
// in practice.
//
// This route is same-origin (aismartstore.co.za/api/track), so every request
// to it already passed through Vercel's edge -- which stamps `x-vercel-ip-*`
// headers on the way in, for free, with no external call and no rate limit.
// This function reads those and forwards them to `track-pageview` alongside
// the beacon payload; `track-pageview` uses them directly instead of doing
// its own lookup when they're present.
//
// (The original ask was to use Cloudflare Workers for this, since the
// storefront domain is Cloudflare-proxied. That would need a Cloudflare API
// token/dashboard access this environment doesn't have -- Workers can only
// be *read*, not deployed, through the connector available here. This gets
// the identical practical result -- free, reliable geo with zero third-party
// calls -- through the deploy pipeline that's already fully wired up.)
export const config = { runtime: "edge" };

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405 });
  }
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    // Misconfiguration, not a visitor-facing failure -- swallow it the same
    // way the rest of the tracking path fails open.
    return new Response(null, { status: 204 });
  }

  let body: { path?: string; source?: string; device_type?: string; session_id?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), { status: 400 });
  }

  // Two independent geo signals, not one: the storefront is DNS-proxied
  // through Cloudflare in front of Vercel, and Cloudflare stamps its own
  // cf-ipcountry header on every request it forwards to origin (free, on
  // every plan, no Worker required). Preferring Vercel's own header when
  // present and falling back to Cloudflare's covers the case where either
  // one is ever missing or wrong for a given request, rather than the
  // whole pageview silently reading "Unknown" because of a single point of
  // failure. Cloudflare's header is country-only (city needs an Enterprise
  // plan or a Worker actually running compute) -- city stays Vercel-only.
  const country = req.headers.get("x-vercel-ip-country") || req.headers.get("cf-ipcountry");
  const city = req.headers.get("x-vercel-ip-city");

  try {
    await fetch(`${SUPABASE_URL}/functions/v1/track-pageview`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        ...body,
        // decodeURIComponent: Vercel percent-encodes non-ASCII city names
        // (accents, etc.) in this header.
        country: country || undefined,
        city: city ? decodeURIComponent(city) : undefined,
      }),
    });
  } catch {
    // Same fail-open stance as track-pageview itself: a dropped pageview
    // beacon is never worth surfacing to the visitor.
  }

  return new Response(null, { status: 204 });
}
