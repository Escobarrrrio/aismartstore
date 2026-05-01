import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { orderId, amount, currency, cancelUrl, successUrl, failureUrl } = await req.json();

    if (!orderId || !amount) {
      return new Response(JSON.stringify({ error: "orderId and amount are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get Yoco secret key from store_settings
    const { data: setting } = await supabase
      .from("store_settings")
      .select("value")
      .eq("key", "yoco_secret_key")
      .maybeSingle();

    if (!setting?.value) {
      return new Response(JSON.stringify({ error: "Yoco secret key not configured" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const yocoResponse = await fetch("https://payments.yoco.com/api/checkouts", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${setting.value}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: Math.round(amount * 100), // Yoco expects cents
        currency: currency || "ZAR",
        cancelUrl: cancelUrl || "",
        successUrl: successUrl || "",
        failureUrl: failureUrl || "",
        metadata: { orderId },
      }),
    });

    const yocoData = await yocoResponse.json();

    if (!yocoResponse.ok) {
      console.error("Yoco API error:", yocoData);
      return new Response(JSON.stringify({ error: "Payment gateway error", details: yocoData }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Update order with payment ID
    await supabase
      .from("orders")
      .update({ payment_id: yocoData.id })
      .eq("id", orderId);

    return new Response(JSON.stringify({ redirectUrl: yocoData.redirectUrl, checkoutId: yocoData.id }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
