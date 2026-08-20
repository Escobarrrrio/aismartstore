// Edge Function: process-order-emails
// Drains public.order_email_queue with exponential backoff.
// Access: internal cron secret (x-internal-secret) OR an admin JWT.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@4.0.1";
import { getAuthContext } from "../_shared/auth-guard.ts";
import { resolveEmailFromAddress } from "../_shared/email-from.ts";
import { deliverQueued, type QueueRow } from "../_shared/order-email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const BATCH = 25;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const internalSecret = Deno.env.get("INTERNAL_CRON_SECRET") ?? "";
    const isInternal = internalSecret.length > 0 && (req.headers.get("x-internal-secret") ?? "") === internalSecret;
    if (!isInternal) {
      const auth = await getAuthContext(req);
      if (!auth.userId) return json({ error: "Unauthorized" }, 401);
      if (!auth.isAdmin) return json({ error: "Forbidden" }, 403);
    }

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) return json({ success: true, processed: 0, reason: "RESEND_API_KEY not configured" });

    const { data: rows, error } = await supabase
      .from("order_email_queue")
      .select("id, order_id, template_status, recipient_email, subject, body_html, attempts, max_attempts")
      .eq("status", "queued")
      .lte("next_attempt_at", new Date().toISOString())
      .order("created_at", { ascending: true })
      .limit(BATCH);

    if (error) return json({ error: error.message }, 500);

    const resend = new Resend(resendKey);
    const from = await resolveEmailFromAddress(supabase);
    const tally = { sent: 0, retry: 0, failed: 0 };

    for (const row of (rows ?? []) as QueueRow[]) {
      const outcome = await deliverQueued(supabase, resend, from, row);
      tally[outcome] += 1;
    }

    return json({ success: true, processed: (rows ?? []).length, ...tally });
  } catch (e) {
    console.error("[process-order-emails] failure:", e);
    return json({ error: (e as Error).message }, 500);
  }
});
