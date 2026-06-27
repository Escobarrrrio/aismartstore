import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2/cors";

// Stripe Checkout for international customers. Yoco (South African,
// ZAR-only) stays the default for local shoppers; this handles
// USD/EUR/GBP/JPY/AUD/CAD/NZD/CHF/CNY/INR -- the currencies already
// supported in the currency switcher. Stripe is the globally recognized
// checkout brand most likely to read as legitimate (not "is this a
// scam") to US/European/Asian customers who've never heard of Yoco.

const STRIPE_SUPPORTED = new Set(["USD", "EUR", "GBP", "JPY", "AUD", "CAD", "NZD", "CHF", "CNY", "INR"]);
// Zero-decimal currencies in Stripe's API (amount is the whole unit, not cents)
const ZERO_DECIMAL = new Set(["JPY"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { orderId, amount, currency, successUrl, cancelUrl, lineItemName } = await req.json();

    if (!orderId || !amount || !currency) {
      return new Response(JSON.stringify({ error: "orderId, amount, and currency are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!STRIPE_SUPPORTED.has(currency)) {
      return new Response(JSON.stringify({ error: `${currency} is not supported by Stripe checkout here. Use Yoco for ZAR.` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: setting } = await supabase
      .from("store_settings")
      .select("value")
      .eq("key", "stripe_secret_key")
      .maybeSingle();

    if (!setting?.value) {
      return new Response(JSON.stringify({ error: "Stripe secret key not configured" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const unitAmount = ZERO_DECIMAL.has(currency) ? Math.round(amount) : Math.round(amount * 100);

    const body = new URLSearchParams({
      "mode": "payment",
      "success_url": successUrl,
      "cancel_url": cancelUrl,
      "client_reference_id": orderId,
      "line_items[0][price_data][currency]": currency.toLowerCase(),
      "line_items[0][price_data][unit_amount]": String(unitAmount),
      "line_items[0][price_data][product_data][name]": lineItemName || `AI Smart Store Order #${orderId.slice(0, 8)}`,
      "line_items[0][quantity]": "1",
    });

    const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${setting.value}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });

    const session = await stripeRes.json();

    if (!stripeRes.ok) {
      return new Response(JSON.stringify({ error: session.error?.message || "Stripe checkout creation failed" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ redirectUrl: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
