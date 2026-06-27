import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2/cors";

// PayPal Checkout for international customers -- replaces the Stripe
// path (kept in the repo but dormant) since PayPal directly supports
// South African merchant accounts and Stripe does not. PayPal's Orders
// v2 API: create an order here, customer approves on PayPal's hosted
// page, then capture-paypal-order finalizes the charge.

const PAYPAL_SUPPORTED = new Set(["USD", "EUR", "GBP", "JPY", "AUD", "CAD", "NZD", "CHF", "CNY", "INR"]);
const PAYPAL_API_BASE = "https://api-m.paypal.com"; // switch to api-m.sandbox.paypal.com while testing

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
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { orderId, amount, currency, successUrl, cancelUrl, description } = await req.json();

    if (!orderId || !amount || !currency) {
      return new Response(JSON.stringify({ error: "orderId, amount, and currency are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!PAYPAL_SUPPORTED.has(currency)) {
      return new Response(JSON.stringify({ error: `${currency} is not supported by PayPal checkout here.` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: settingsRows } = await supabase
      .from("store_settings")
      .select("key, value")
      .in("key", ["paypal_client_id", "paypal_client_secret"]);

    const settings = Object.fromEntries((settingsRows || []).map((r) => [r.key, r.value]));
    if (!settings.paypal_client_id || !settings.paypal_client_secret) {
      return new Response(JSON.stringify({ error: "PayPal credentials not configured" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accessToken = await getAccessToken(settings.paypal_client_id, settings.paypal_client_secret);

    const paypalRes = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: orderId,
            description: description || `AI Smart Store Order #${orderId.slice(0, 8)}`,
            amount: {
              currency_code: currency,
              value: amount.toFixed(2),
            },
          },
        ],
        application_context: {
          brand_name: "AI Smart Store",
          return_url: successUrl,
          cancel_url: cancelUrl,
          user_action: "PAY_NOW",
        },
      }),
    });

    const order = await paypalRes.json();

    if (!paypalRes.ok) {
      return new Response(JSON.stringify({ error: order.message || "PayPal order creation failed" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const approveLink = order.links?.find((l: any) => l.rel === "approve")?.href;

    return new Response(JSON.stringify({ redirectUrl: approveLink, paypalOrderId: order.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
