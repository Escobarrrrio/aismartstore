import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAuthContext, unauthorized, forbidden } from "../_shared/auth-guard.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type Probe = {
  label: string;
  args: Record<string, unknown>;
  duration_ms: number;
  ok: boolean;
  row_count: number;
  total_count: number | null;
  error: string | null;
  timeout: boolean;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = await getAuthContext(req);
    if (!auth.userId) return unauthorized(corsHeaders);
    if (!auth.isAdmin) return forbidden(corsHeaders);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Catalog counts
    const [{ count: activeCount }, { count: inactiveCount }, { count: missingImages }, { count: missingPrice }] =
      await Promise.all([
        admin.from("products").select("id", { head: true, count: "exact" }).eq("is_active", true),
        admin.from("products").select("id", { head: true, count: "exact" }).eq("is_active", false),
        admin.from("products").select("id", { head: true, count: "exact" }).eq("is_active", true).or("images.is.null,images.eq.{}"),
        admin.from("products").select("id", { head: true, count: "exact" }).eq("is_active", true).or("price.is.null,price.eq.0"),
      ]);

    // Timed probes against search_products (public anon-callable)
    const probes: Probe[] = [];
    const probeSpecs: { label: string; args: Record<string, unknown> }[] = [
      { label: "Default listing (newest, no filter)", args: { search_query: "", sort_by: "newest", page_number: 0, page_size: 24 } },
      { label: "Relevance sort, empty query", args: { search_query: "", sort_by: "relevance", page_number: 0, page_size: 24 } },
      { label: "Price ascending", args: { search_query: "", sort_by: "price_asc", page_number: 0, page_size: 24 } },
      { label: "Search 'laptop'", args: { search_query: "laptop", sort_by: "relevance", page_number: 0, page_size: 24 } },
      { label: "AI-only filter", args: { search_query: "", filter_ai_only: true, sort_by: "newest", page_number: 0, page_size: 24 } },
      { label: "Deep pagination (page 20)", args: { search_query: "", sort_by: "newest", page_number: 20, page_size: 24 } },
    ];

    for (const spec of probeSpecs) {
      const start = performance.now();
      const { data, error } = await admin.rpc("search_products", spec.args as any);
      const duration = Math.round(performance.now() - start);
      const msg = error?.message ?? null;
      probes.push({
        label: spec.label,
        args: spec.args,
        duration_ms: duration,
        ok: !error,
        row_count: Array.isArray(data) ? data.length : 0,
        total_count: Array.isArray(data) && data.length > 0 ? Number((data[0] as any).total_count ?? 0) : null,
        error: msg,
        timeout: !!msg && /statement timeout|57014/i.test(msg),
      });
    }

    const flags: string[] = [];
    if (probes.some((p) => p.timeout)) flags.push("statement_timeout");
    if (probes.some((p) => !p.ok && !p.timeout)) flags.push("query_error");
    if (probes.some((p) => p.ok && p.duration_ms > 2500)) flags.push("slow_query");
    if ((activeCount ?? 0) === 0) flags.push("empty_catalog");
    if ((missingImages ?? 0) > 0) flags.push("active_missing_images");
    if ((missingPrice ?? 0) > 0) flags.push("active_missing_price");

    const status = flags.length === 0 ? "healthy" : flags.includes("statement_timeout") || flags.includes("empty_catalog") ? "critical" : "warning";

    return new Response(
      JSON.stringify({
        status,
        flags,
        checked_at: new Date().toISOString(),
        counts: {
          active: activeCount ?? 0,
          inactive: inactiveCount ?? 0,
          active_missing_images: missingImages ?? 0,
          active_missing_price: missingPrice ?? 0,
        },
        probes,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
