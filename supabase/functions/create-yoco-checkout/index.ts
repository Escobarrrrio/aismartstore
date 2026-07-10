import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2/cors";
import { getAuthContext, unauthorized, forbidden } from "../_shared/auth-guard.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = await getAuthContext(req);
    if (!auth.userId) return unauthorized(corsHeaders);

    const { orderId, currency, cancelUrl, successUrl, failureUrl } = await req.json();
    if (!orderId) {
      return new Response(JSON.stringify({ error: "orderId is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // SECURITY: fetch authoritative amount from DB — never trust client
    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select("id, user_id, total_amount, status")
      .eq("id", orderId)
      .maybeSingle();
    if (orderErr || !order) {
      return new Response(JSON.stringify({ error: "Order not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (order.user_id !== auth.userId && !auth.isAdmin) return forbidden(corsHeaders);

    let yocoSecretKey = Deno.env.get("YOCO_SECRET_KEY") ?? "";
    if (!yocoSecretKey) {
      const { data: setting } = await supabase
        .from("store_settings").select("value").eq("key", "yoco_secret_key").maybeSingle();
      yocoSecretKey = (setting?.value as string) ?? "";
    }
    if (!yocoSecretKey) {
      return new Response(JSON.stringify({ error: "Yoco secret key not configured" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authoritativeAmount = Number(order.total_amount);

    const yocoResponse = await fetch("https://payments.yoco.com/api/checkouts", {
      method: "POST",
      headers: { "Authorization": `Bearer ${yocoSecretKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: Math.round(authoritativeAmount * 100),
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
      return new Response(JSON.stringify({ error: "Payment gateway error" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("orders").update({ payment_id: yocoData.id }).eq("id", orderId);

    return new Response(JSON.stringify({ redirectUrl: yocoData.redirectUrl, checkoutId: yocoData.id }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
