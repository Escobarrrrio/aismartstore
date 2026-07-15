// Edge Function: notify-order
// Sends transactional emails for an order.
// Access: caller must be an admin, the order's owner, OR provide the
// internal cron/service secret (used by webhook + capture handlers).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@4.0.1";
import { getAuthContext, escapeHtml } from "../_shared/auth-guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
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
    <p style="color:#64748b;margin:0 0 24px">Order <strong>${escapeHtml(order.id)}</strong></p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
      <tr><td style="padding:6px 0;color:#64748b">Customer</td><td style="padding:6px 0">${escapeHtml(order.customer_name ?? "—")}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b">Email</td><td style="padding:6px 0">${escapeHtml(order.customer_email ?? "—")}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b">Phone</td><td style="padding:6px 0">${escapeHtml(order.customer_phone ?? "—")}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b">Address</td><td style="padding:6px 0">${escapeHtml(order.address ?? "")}, ${escapeHtml(order.city ?? "")} ${escapeHtml(order.postal_code ?? "")}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b">Status</td><td style="padding:6px 0">${escapeHtml(order.status ?? "pending")}</td></tr>
    </table>
    <table style="width:100%;border-collapse:collapse;border-top:1px solid #e2e8f0">
      <thead><tr><th align="left" style="padding:8px 0">Item</th><th align="right" style="padding:8px 0">Qty</th><th align="right" style="padding:8px 0">Price</th></tr></thead>
      <tbody>${itemRows}</tbody>
    </table>
    <p style="margin-top:24px;font-size:18px"><strong>Total: ${escapeHtml(formatZAR(Number(order.total_amount)))}</strong></p>
  </div>`;
}

function estimatedDeliveryWindow(order: any): { label: string; from: Date; to: Date } {
  // Business-day ETA: 2 days processing + 3–5 day courier for ZA metros.
  // If any item is out of stock, add a 3–7 day backorder window.
  const items = (order.order_items || []) as any[];
  const anyBackorder = items.some((i) => (i.products?.stock_quantity ?? 0) < i.quantity);
  const start = new Date();
  const addDays = (d: Date, n: number) => { const c = new Date(d); c.setDate(c.getDate() + n); return c; };
  const from = addDays(start, anyBackorder ? 5 : 2);
  const to = addDays(start, anyBackorder ? 12 : 7);
  const fmt = (d: Date) => d.toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" });
  return { label: `${fmt(from)} – ${fmt(to)}${anyBackorder ? " (backorder)" : ""}`, from, to };
}

function buildCustomerHtml(order: any, itemRows: string) {
  const eta = estimatedDeliveryWindow(order);
  return `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#0f172a">
    <h1 style="font-size:22px;margin:0 0 8px">Thank you for your order, ${escapeHtml(order.customer_name ?? "")}</h1>
    <p style="color:#475569;margin:0 0 20px">We've received your order <strong>#${escapeHtml(String(order.id).slice(0, 8))}</strong> and it's now being prepared.</p>
    <div style="background:#f1f5f9;border-radius:10px;padding:14px 16px;margin:0 0 20px">
      <p style="margin:0 0 4px;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.06em"><strong>Estimated delivery</strong></p>
      <p style="margin:0;font-size:16px;font-weight:600">${escapeHtml(eta.label)}</p>
      <p style="margin:6px 0 0;font-size:12px;color:#64748b">Shipping to: ${escapeHtml(order.address ?? "")}, ${escapeHtml(order.city ?? "")} ${escapeHtml(order.postal_code ?? "")}</p>
    </div>
    <table style="width:100%;border-collapse:collapse;border-top:1px solid #e2e8f0">
      <thead><tr><th align="left" style="padding:8px 0">Item</th><th align="right" style="padding:8px 0">Qty</th><th align="right" style="padding:8px 0">Price</th></tr></thead>
      <tbody>${itemRows}</tbody>
    </table>
    <p style="margin-top:24px;font-size:18px"><strong>Total: ${escapeHtml(formatZAR(Number(order.total_amount)))}</strong></p>
    <p style="color:#64748b;font-size:13px;margin-top:32px">If you have any questions, just reply to this email — we're here to help.</p>
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

    // Authorization: internal secret (webhooks / capture flow) OR admin/order owner.
    const internalSecret = Deno.env.get("INTERNAL_CRON_SECRET") ?? "";
    const providedSecret = req.headers.get("x-internal-secret") ?? "";
    const isInternal = internalSecret.length > 0 && providedSecret === internalSecret;

    const [{ data: emailSetting }, { data: order }] = await Promise.all([
      supabase.from("store_settings").select("value").eq("key", "notification_email").maybeSingle(),
      supabase.from("orders").select("*, order_items(*, products(name, stock_quantity))").eq("id", orderId).maybeSingle(),
    ]);

    if (!order) {
      return new Response(JSON.stringify({ error: "Order not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!isInternal) {
      const auth = await getAuthContext(req);
      if (!auth.userId) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!auth.isAdmin && order.user_id !== auth.userId) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const items = (order.order_items || []) as any[];
    const itemRows = items.map((i) => `
      <tr style="border-bottom:1px solid #f1f5f9">
        <td style="padding:8px 0">${escapeHtml(i.products?.name ?? "Product")}</td>
        <td align="right" style="padding:8px 0">${escapeHtml(i.quantity)}</td>
        <td align="right" style="padding:8px 0">${escapeHtml(formatZAR(Number(i.unit_price)))}</td>
      </tr>`).join("");

    const ownerHtml = buildOwnerHtml(order, itemRows);
    const customerHtml = buildCustomerHtml(order, itemRows);

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      console.warn("[notify-order] RESEND_API_KEY missing — falling back to log-only", { orderId });
      return new Response(JSON.stringify({ success: true, sent: false, reason: "RESEND_API_KEY not configured" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resend = new Resend(resendKey);
    const results: Record<string, unknown> = {};

    const logSend = async (
      role: "owner" | "customer",
      recipient: string,
      template: string,
      status: "sent" | "failed",
      err: string | null,
      providerId?: string,
    ) => {
      const message_id = `order-notify-${orderId}-${role}`;
      await supabase.from("email_send_log").upsert({
        message_id, template_name: template, recipient_email: recipient,
        status, error_message: err,
        metadata: { orderId, role, provider_id: providerId ?? null },
      }, { onConflict: "message_id" });
      await supabase.from("order_audit_log").insert({
        order_id: orderId,
        actor_email: "notify-order",
        event_type: status === "sent" ? "email.sent" : "email.failed",
        to_value: recipient,
        metadata: { role, template, error: err, provider_id: providerId ?? null },
      });
    };

    if (emailSetting?.value) {
      try {
        const r = await resend.emails.send({
          from: FROM_ADDRESS, to: [emailSetting.value],
          subject: `New order ${order.id} — ${formatZAR(Number(order.total_amount))}`,
          html: ownerHtml,
        });
        results.owner = r;
        await logSend("owner", emailSetting.value, "order-owner-notification",
          r?.error ? "failed" : "sent",
          r?.error ? (r.error.message ?? "resend error") : null,
          (r as any)?.data?.id);
      } catch (e) {
        await logSend("owner", emailSetting.value, "order-owner-notification", "failed", (e as Error).message);
        throw e;
      }
    }
    if (order.customer_email) {
      try {
        const r = await resend.emails.send({
          from: FROM_ADDRESS, to: [order.customer_email],
          subject: `Your order is confirmed — ${order.id}`,
          html: customerHtml,
        });
        results.customer = r;
        await logSend("customer", order.customer_email, "order-confirmation",
          r?.error ? "failed" : "sent",
          r?.error ? (r.error.message ?? "resend error") : null,
          (r as any)?.data?.id);
      } catch (e) {
        await logSend("customer", order.customer_email, "order-confirmation", "failed", (e as Error).message);
        throw e;
      }
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
