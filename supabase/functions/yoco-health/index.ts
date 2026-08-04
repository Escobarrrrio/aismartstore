// Admin-only diagnostics for Yoco integration:
//  - detects live vs test mode from the configured YOCO_SECRET_KEY (see mode.ts
//    for why that check moved out to its own tested module)
//  - reports whether YOCO_WEBHOOK_SECRET is set
//  - pings the yoco-webhook endpoint to confirm reachability
//  - returns the latest 20 webhook events from automation_events

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { getAuthContext } from "../_shared/auth-guard.ts";
import { detectYocoMode } from "./mode.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = await getAuthContext(req);
    if (!auth.userId || !auth.isAdmin) {
      return new Response(JSON.stringify({ error: "Admin required" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const secretKey = Deno.env.get("YOCO_SECRET_KEY") ?? "";
    const webhookSecret = Deno.env.get("YOCO_WEBHOOK_SECRET") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

    const mode = detectYocoMode(secretKey);

    // Endpoint reachability (OPTIONS should always answer with `ok`).
    const endpoint = `${supabaseUrl}/functions/v1/yoco-webhook`;
    let reachable = false;
    let reachableStatus: number | null = null;
    try {
      const res = await fetch(endpoint, { method: "OPTIONS" });
      reachableStatus = res.status;
      reachable = res.status < 500;
      await res.text();
    } catch (e) {
      console.warn("[yoco-health] endpoint fetch failed:", (e as Error).message);
    }

    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: events } = await supabase
      .from("automation_events")
      .select("id, event_type, status, error_message, payload, created_at")
      .eq("source", "yoco")
      .order("created_at", { ascending: false })
      .limit(20);

    const { count: signatureFailures } = await supabase
      .from("automation_events")
      .select("id", { count: "exact", head: true })
      .eq("source", "yoco")
      .eq("event_type", "webhook.signature_failed")
      .gte("created_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString());

    return new Response(JSON.stringify({
      mode,
      secret_key_configured: Boolean(secretKey),
      webhook_secret_configured: Boolean(webhookSecret),
      endpoint,
      endpoint_reachable: reachable,
      endpoint_status: reachableStatus,
      signature_failures_24h: signatureFailures ?? 0,
      events: events ?? [],
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[yoco-health] failure:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
