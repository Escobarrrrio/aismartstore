import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { getAuthContext } from "../_shared/auth-guard.ts";
import { withRetry } from "../_shared/retry.ts";
import { startRun, finishRun } from "../_shared/run-log.ts";
import { checkAndAlertOnFailureStreak } from "../_shared/alerts.ts";

// Iteratively deactivate products whose primary image is on the blocklist.
// Safe to call repeatedly; stops when a batch returns 0 rows or time runs out.

// Named + assigned and gated behind import.meta.main so this module can be
// imported by tests without also starting an HTTP listener.
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

  const run = await startRun(supabase, "cleanup-blocked-products");

  while (Date.now() - started < MAX_MS) {
    let data: unknown;
    let rpcError: { message: string } | null = null;
    try {
      // A single batch failing (e.g. transient DB contention) shouldn't
      // sink the whole run -- retry with backoff before giving up on it.
      data = await withRetry(
        async () => {
          const { data: batchData, error } = await supabase.rpc("deactivate_blocked_products_batch", { batch_size: BATCH });
          if (error) throw new Error(error.message);
          return batchData;
        },
        { onRetry: (n, e) => console.warn(`[cleanup-blocked-products] batch retry ${n}:`, (e as Error).message) },
      );
    } catch (e) {
      rpcError = { message: (e as Error).message };
    }

    if (rpcError) {
      await finishRun(supabase, run, {
        status: "failed",
        items_synced: totalDeactivated,
        items_failed: 1,
        error_details: rpcError.message,
      });
      await checkAndAlertOnFailureStreak(supabase, "cleanup-blocked-products").catch((e) =>
        console.error("[cleanup-blocked-products] alert check failed:", (e as Error).message),
      );
      return new Response(JSON.stringify({ error: rpcError.message, totalDeactivated, batches }), {
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

  await finishRun(supabase, run, { status: "success", items_synced: totalDeactivated, items_failed: 0 });

  return new Response(JSON.stringify({
    ok: true, totalDeactivated, batches, activeRemaining: activeCount,
    elapsedMs: Date.now() - started,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
};

if (import.meta.main) Deno.serve(handler);
