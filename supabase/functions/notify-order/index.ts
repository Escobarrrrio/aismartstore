// Edge Function: notify-order
// Sends two transactional emails when an order is placed:
//   1) Owner notification → notification_email from store_settings
//   2) Customer confirmation → order.customer_email
//
// Uses Resend (provisioned by Lovable Emails). Set RESEND_API_KEY as a
// function secret. The function degrades gracefully — if RESEND_API_KEY is
// missing, it logs the email and still returns 200 so checkout is never blocked.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@4.0.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FROM_ADDRESS = Deno.env.get("ORDER_FROM_ADDRESS") ?? "Orders <orders@resend.dev>";

function formatZAR(value: number) {
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(value || 0);
}

function buildOwnerHtml(order: any, itemRows: string) {
  return `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#0f172a">
    <h1 style="font-size:20px;margin:0 0 4px">New order placed</h1>
    <p style="color:#64748b;margin:0 0 24px">Order <strong>${order.id}</strong></p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
      <tr><td style="padding:6px 0;color:#64748b">Customer</td><td style="padding:6px 0">${order.customer_name ?? "—"}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b">Email</td><td style="padding:6px 0">${order.customer_email ?? "—"}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b">Phone</td><td style="padding:6px 0">${order.customer_phone ?? "—"}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b">Address</td><td style="padding:6px 0">${order.address ?? ""}, ${order.city ?? ""} ${order.postal_code ?? ""}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b">Status</td><td style="padding:6px 0">${order.status ?? "pending"}</td></tr>
    </table>
    <table style="width:100%;border-collapse:collapse;border-top:1px solid #e2e8f0">
      <thead><tr><th align="left" style="padding:8px 0">Item</th><th align="right" style="padding:8px 0">Qty</th><th align="right" style="padding:8px 0">Price</th></tr></thead>
      <tbody>${itemRows}</tbody>
    </table>
    <p style="margin-top:24px;font-size:18px"><strong>Total: ${formatZAR(Number(order.total_amount))}</strong></p>
  </div>`;
}

function buildCustomerHtml(order: any, itemRows: string) {
  return `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#0f172a">
    <h1 style="font-size:22px;margin:0 0 8px">Thank you for your order, ${order.customer_name ?? ""}</h1>
    <p style="color:#475569;margin:0 0 24px">We've received your order <strong>${order.id}</strong> and will email you again once it ships.</p>
    <table style="width:100%;border-collapse:collapse;border-top:1px solid #e2e8f0">
      <thead><tr><th align="left" style="padding:8px 0">Item</th><th align="right" style="padding:8px 0">Qty</th><th align="right" style="padding:8px 0">Price</th></tr></thead>
      <tbody>${itemRows}</tbody>
    </table>
    <p style="margin-top:24px;font-size:18px"><strong>Total: ${formatZAR(Number(order.total_amount))}</strong></p>
    <p style="color:#64748b;font-size:13px;margin-top:32px">If you have any questions, just reply to this email.</p>
  </div>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { orderId } = await req.json();
    if (!orderId) {
      return new Response(JSON.stringify({ error: "orderId is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const [{ data: emailSetting }, { data: order }] = await Promise.all([
      supabase.from("store_settings").select("value").eq("key", "notification_email").maybeSingle(),
      supabase.from("orders").select("*, order_items(*, products(name))").eq("id", orderId).maybeSingle(),
    ]);

    if (!order) {
      return new Response(JSON.stringify({ error: "Order not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const items = (order.order_items || []) as any[];
    const itemRows = items.map((i) => `
      <tr style="border-bottom:1px solid #f1f5f9">
        <td style="padding:8px 0">${i.products?.name ?? "Product"}</td>
        <td align="right" style="padding:8px 0">${i.quantity}</td>
        <td align="right" style="padding:8px 0">${formatZAR(Number(i.unit_price))}</td>
      </tr>`).join("");

    const ownerHtml = buildOwnerHtml(order, itemRows);
    const customerHtml = buildCustomerHtml(order, itemRows);

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      console.warn("[notify-order] RESEND_API_KEY missing — falling back to log-only", {
        owner: emailSetting?.value, customer: order.customer_email, orderId,
      });
      return new Response(JSON.stringify({ success: true, sent: false, reason: "RESEND_API_KEY not configured" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resend = new Resend(resendKey);
    const results: Record<string, unknown> = {};

    if (emailSetting?.value) {
      const r = await resend.emails.send({
        from: FROM_ADDRESS, to: [emailSetting.value],
        subject: `New order ${order.id} — ${formatZAR(Number(order.total_amount))}`,
        html: ownerHtml,
      });
      results.owner = r;
    }
    if (order.customer_email) {
      const r = await resend.emails.send({
        from: FROM_ADDRESS, to: [order.customer_email],
        subject: `Your order is confirmed — ${order.id}`,
        html: customerHtml,
      });
      results.customer = r;
    }

    return new Response(JSON.stringify({ success: true, sent: true, results }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[notify-order] failure:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
