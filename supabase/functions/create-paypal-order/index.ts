import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2/cors";
import { getAuthContext, unauthorized, forbidden } from "../_shared/auth-guard.ts";

const PAYPAL_SUPPORTED = new Set(["USD", "EUR", "GBP", "JPY", "AUD", "CAD", "NZD", "CHF", "CNY", "INR"]);
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

    const { orderId, currency, successUrl, cancelUrl, description } = await req.json();
    if (!orderId || !currency) {
      return new Response(JSON.stringify({ error: "orderId and currency are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!PAYPAL_SUPPORTED.has(currency)) {
      return new Response(JSON.stringify({ error: `${currency} is not supported by PayPal checkout here.` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // SECURITY: fetch authoritative amount server-side; never trust client-supplied amount.
    const { data: order } = await supabase
      .from("orders")
      .select("id, user_id, total_amount")
      .eq("id", orderId)
      .maybeSingle();
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
    if (!settings.paypal_client_id || !settings.paypal_client_secret) {
      return new Response(JSON.stringify({ error: "PayPal credentials not configured" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accessToken = await getAccessToken(settings.paypal_client_id, settings.paypal_client_secret);
    // Order totals are stored in ZAR. Convert authoritatively server-side to the
    // buyer's chosen currency using our exchange_rates table so PayPal receives
    // a value that actually matches the currency_code label.
    const zarTotal = Number(order.total_amount);
    let authoritativeAmount = zarTotal;
    if (currency !== "ZAR") {
      const { data: rateRow } = await supabase
        .from("exchange_rates").select("rate_to_zar").eq("currency_code", currency).maybeSingle();
      const rate = Number(rateRow?.rate_to_zar);
      if (!rate || rate <= 0) {
        return new Response(JSON.stringify({ error: `No exchange rate available for ${currency}` }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      authoritativeAmount = zarTotal / rate;
    }

    const paypalRes = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [{
          reference_id: orderId,
          description: description || `AI Smart Store Order #${orderId.slice(0, 8)}`,
          amount: { currency_code: currency, value: authoritativeAmount.toFixed(2) },
        }],
        application_context: {
          brand_name: "AI Smart Store",
          return_url: successUrl,
          cancel_url: cancelUrl,
          user_action: "PAY_NOW",
        },
      }),
    });

    const order2 = await paypalRes.json();
    if (!paypalRes.ok) {
      return new Response(JSON.stringify({ error: order2.message || "PayPal order creation failed" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const approveLink = order2.links?.find((l: any) => l.rel === "approve")?.href;
    return new Response(JSON.stringify({ redirectUrl: approveLink, paypalOrderId: order2.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
