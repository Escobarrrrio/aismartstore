import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { getAuthContext } from "../_shared/auth-guard.ts";

// Iteratively deactivate products whose primary image is on the blocklist.
// Safe to call repeatedly; stops when a batch returns 0 rows or time runs out.

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const internalSecret = Deno.env.get("INTERNAL_CRON_SECRET") ?? "";
  const providedSecret = req.headers.get("x-internal-secret") ?? "";
  const isInternal = internalSecret.length > 0 && providedSecret === internalSecret;
  if (!isInternal) {
    const auth = await getAuthContext(req);
    if (!auth.userId || !auth.isAdmin) {
      return new Response(JSON.stringify({ error: "Admin role required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const started = Date.now();
  const MAX_MS = 110_000;
  const BATCH = 1500;
  let totalDeactivated = 0;
  let batches = 0;

  while (Date.now() - started < MAX_MS) {
    const { data, error } = await supabase.rpc("deactivate_blocked_products_batch", { batch_size: BATCH });
    if (error) {
      return new Response(JSON.stringify({ error: error.message, totalDeactivated, batches }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const n = Number(data ?? 0);
    totalDeactivated += n;
    batches++;
    if (n === 0) break;
  }

  const { count: activeCount } = await supabase
    .from("products").select("id", { count: "exact", head: true }).eq("is_active", true);

  return new Response(JSON.stringify({
    ok: true, totalDeactivated, batches, activeRemaining: activeCount,
    elapsedMs: Date.now() - started,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
