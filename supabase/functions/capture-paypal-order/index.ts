import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2/cors";
import { getAuthContext, unauthorized, forbidden } from "../_shared/auth-guard.ts";

const PAYPAL_API_BASE = "https://api-m.paypal.com";

async function getAccessToken(clientId: string, clientSecret: string): Promise<string> {
  const res = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || "PayPal auth failed");
  return data.access_token;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = await getAuthContext(req);
    if (!auth.userId) return unauthorized(corsHeaders);

    const { paypalOrderId, orderId } = await req.json();
    if (!paypalOrderId || !orderId) {
      return new Response(JSON.stringify({ error: "paypalOrderId and orderId are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: order } = await supabase
      .from("orders").select("id, user_id, total_amount").eq("id", orderId).maybeSingle();
    if (!order) {
      return new Response(JSON.stringify({ error: "Order not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (order.user_id !== auth.userId && !auth.isAdmin) return forbidden(corsHeaders);

    const { data: settingsRows } = await supabase
      .from("store_settings").select("key, value")
      .in("key", ["paypal_client_id", "paypal_client_secret"]);
    const settings = Object.fromEntries((settingsRows || []).map((r) => [r.key, r.value]));

    const accessToken = await getAccessToken(settings.paypal_client_id, settings.paypal_client_secret);

    const captureRes = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders/${paypalOrderId}/capture`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    });

    const capture = await captureRes.json();

    if (!captureRes.ok || capture.status !== "COMPLETED") {
      return new Response(JSON.stringify({ status: "failed" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // SECURITY: verify the captured amount matches the order's authoritative total.
    const capturedUnit = capture?.purchase_units?.[0]?.payments?.captures?.[0]?.amount;
    const capturedValue = Number(capturedUnit?.value ?? 0);
    const expected = Number(order.total_amount);
    if (!capturedValue || Math.abs(capturedValue - expected) > 0.01) {
      console.error("[capture-paypal-order] amount mismatch", { expected, capturedValue });
      return new Response(JSON.stringify({ status: "amount_mismatch" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("orders").update({ status: "paid" }).eq("id", orderId);
    await supabase.functions.invoke("notify-order", {
      body: { orderId },
      headers: { "x-internal-secret": Deno.env.get("INTERNAL_CRON_SECRET") ?? "" },
    });

    return new Response(JSON.stringify({ status: "completed" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
