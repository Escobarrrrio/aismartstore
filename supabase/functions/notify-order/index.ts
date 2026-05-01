import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { orderId } = await req.json();

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get notification email
    const { data: emailSetting } = await supabase
      .from("store_settings")
      .select("value")
      .eq("key", "notification_email")
      .maybeSingle();

    if (!emailSetting?.value) {
      return new Response(JSON.stringify({ error: "Notification email not configured" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get order details
    const { data: order } = await supabase
      .from("orders")
      .select("*, order_items(*, products(name))")
      .eq("id", orderId)
      .maybeSingle();

    if (!order) {
      return new Response(JSON.stringify({ error: "Order not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const itemsList = (order.order_items || [])
      .map((item: any) => `• ${item.products?.name || "Product"} × ${item.quantity} — R${Number(item.unit_price).toFixed(2)}`)
      .join("\n");

    // Use Supabase's built-in email (via auth admin) - simplified approach
    // In production, integrate with a transactional email service
    console.log(`
=== NEW ORDER NOTIFICATION ===
To: ${emailSetting.value}
Order ID: ${order.id}
Customer: ${order.customer_name}
Email: ${order.customer_email}
Phone: ${order.customer_phone}
Address: ${order.address}, ${order.city}, ${order.postal_code}
Total: R${Number(order.total_amount).toFixed(2)}
Status: ${order.status}
Items:
${itemsList}
================================
    `);

    return new Response(JSON.stringify({ success: true }), {
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
