import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2/cors";

/**
 * First-party pageview tracking. No vendor, no third-party script, no
 * cross-site cookie -- an anonymous per-browser id the client already
 * generated (see usePageViewTracking.ts) is all that ties two pageviews
 * together, and the client only calls this once the cookie-consent banner
 * has been accepted.
 *
 * Country and city are best-effort. This function does not have access to a
 * Vercel-style `x-vercel-ip-country` header -- the client calls Supabase's
 * own domain directly, bypassing Vercel entirely -- so a short, non-blocking
 * geo lookup runs against a keyless IP-geolocation API using the connecting
 * IP. If it's slow, rate-limited, or down, the pageview is still recorded
 * with country/city left null and shows as "Unknown" in the admin
 * dashboard. Tracking a visit must never depend on a third party being up.
 */

const GEO_TIMEOUT_MS = 800;

interface Geo { country: string | null; city: string | null }

async function lookupGeo(ip: string | null): Promise<Geo> {
  const empty: Geo = { country: null, city: null };
  if (!ip || ip === "127.0.0.1" || ip.startsWith("::1")) return empty;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GEO_TIMEOUT_MS);
    const res = await fetch(`https://ipapi.co/${ip}/json/`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return empty;
    const data = await res.json();
    // A rate-limited or errored response comes back with an `error: true`
    // field and prose in `reason` instead of real geo fields.
    if (data?.error) return empty;
    const country = typeof data?.country_code === "string" && /^[A-Z]{2}$/.test(data.country_code)
      ? data.country_code
      : null;
    const city = typeof data?.city === "string" && data.city.trim() ? data.city.trim().slice(0, 128) : null;
    return { country, city };
  } catch {
    return empty;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: { path?: string; source?: string; device_type?: string; session_id?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { path, source, device_type, session_id } = body;
  if (!path || !session_id) {
    return new Response(JSON.stringify({ error: "path and session_id are required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Same header order guardrails.ts's callerKey() uses -- the last
  // x-forwarded-for entry is the one the edge proxy itself wrote, and the
  // hardest one for a client to forge.
  const xff = req.headers.get("x-forwarded-for");
  const connectingIp = xff
    ? xff.split(",").map((p) => p.trim()).filter(Boolean).pop() ?? null
    : req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip");

  const geo = await lookupGeo(connectingIp ?? null);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { error } = await admin.from("page_views").insert({
    path: String(path).slice(0, 512),
    source: (source ? String(source) : "direct").slice(0, 128),
    device_type: device_type === "mobile" || device_type === "tablet" ? device_type : "desktop",
    country: geo.country,
    city: geo.city,
    session_id,
  });

  if (error) {
    // A dropped pageview is not worth alarming anyone over -- log and move
    // on, same fail-open stance as the rest of the guardrails module.
    console.error("[track-pageview] insert failed", { error: error.message });
  }

  // 204: nothing for the client to do with the response, and no body means
  // one less thing for a `sendBeacon`-style fire-and-forget call to parse.
  return new Response(null, { status: 204, headers: corsHeaders });
});
