// Edge Function: notify-order
// Sends transactional emails for an order.
// Access: caller must be an admin, the order's owner, OR provide the
// internal cron/service secret (used by webhook + capture handlers).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@4.0.1";
import { getAuthContext, escapeHtml } from "../_shared/auth-guard.ts";
import {
  enqueueOrderEmail,
  deliverQueued,
  isOrderEmailStatus,
  type OrderEmailStatus,
} from "../_shared/order-email.ts";
import { resolveEmailFromAddress } from "../_shared/email-from.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function formatZAR(value: number) {
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(value || 0);
}

// Same publicly-hosted icon used across the site's PWA manifest and the
// auth-email templates (see _shared/email-templates/EmailShell.tsx) --
// one consistent logo everywhere an email goes out from this store.
const EMAIL_HEADER = `
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:18px">
    <tr>
      <td style="vertical-align:middle"><img src="https://aismartstore.co.za/icon-512.png" width="28" height="28" alt="AI Smart Store" style="display:block;border-radius:6px" /></td>
      <td style="vertical-align:middle;padding-left:9px;font-family:Outfit,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:17px;font-weight:800;color:#0f172a">Smart Store</td>
    </tr>
  </table>`;

const EMAIL_FOOTER = `
  <p style="margin:24px 0 0;font-size:11px;color:#94a3b8;line-height:1.5;border-top:1px solid #e2e8f0;padding-top:16px">
    AI Smart Store, a division of AI Job Chommie (Pty) Ltd. &middot; <a href="https://aismartstore.co.za" style="color:#94a3b8">aismartstore.co.za</a>
  </p>`;

function buildOwnerHtml(order: any, itemRows: string) {
  return `
  <div style="background:#f4f4f7;padding:32px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:600px;margin:0 auto">
    ${EMAIL_HEADER}
    <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;padding:28px 24px;color:#0f172a">
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
    </div>
    ${EMAIL_FOOTER}
  </div>
  </div>`;
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const orderId = body?.orderId;
    // `event: "status_update"` + `status` picks the editable per-status
    // template; anything else falls back to the order-confirmation template.
    const requestedStatus = body?.event === "status_update" ? body?.status : "confirmation";
    if (!orderId) {
      return new Response(JSON.stringify({ error: "orderId is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }


    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const FROM_ADDRESS = await resolveEmailFromAddress(supabase);

    // Authorization: internal secret (webhooks / capture flow) OR admin/order owner.
    const internalSecret = Deno.env.get("INTERNAL_CRON_SECRET") ?? "";
    const providedSecret = req.headers.get("x-internal-secret") ?? "";
    const isInternal = internalSecret.length > 0 && providedSecret === internalSecret;

    const [{ data: emailSetting }, { data: order }] = await Promise.all([
      supabase.from("store_settings").select("value").eq("key", "notification_email").maybeSingle(),
      // `specifications` carries supplier + supplier_sku on manually-sourced
      // (dropship) products. Those have to be bought in from the supplier the
      // moment a customer pays, so the data is fetched here to drive the
      // separate action-required alert below.
      supabase.from("orders")
        .select("*, order_items(*, products(name, sku, stock_quantity, specifications))")
        .eq("id", orderId).maybeSingle(),
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
    // Dropship items must be ordered from the supplier straight away, so they
    // get their own alert rather than being buried in the standard owner email
    // -- the subject line has to be scannable on a phone lock screen.
    const dropship = items.filter((i: any) => i.products?.specifications?.supplier);
    if (dropship.length > 0 && emailSetting?.value) {
      const rows = dropship.map((i: any) => {
        const spec = i.products.specifications ?? {};
        return `<tr>
          <td style="padding:8px;border-bottom:1px solid #e2e8f0">${escapeHtml(i.products?.name ?? "Unknown")}</td>
          <td style="padding:8px;border-bottom:1px solid #e2e8f0"><strong>${escapeHtml(String(spec.supplier ?? "—"))}</strong></td>
          <td style="padding:8px;border-bottom:1px solid #e2e8f0;font-family:monospace">${escapeHtml(String(spec.supplier_sku ?? i.products?.sku ?? "—"))}</td>
          <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right">${Number(i.quantity ?? 1)}</td>
        </tr>`;
      }).join("");

      const html = `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:24px">
          <h1 style="font-size:19px;color:#b45309;margin:0 0 8px">&#128230; Place these supplier orders now</h1>
          <p style="color:#334155;font-size:14px;line-height:1.6">
            Order <strong>${escapeHtml(order.id)}</strong> is paid and contains
            ${dropship.length} item${dropship.length === 1 ? "" : "s"} you source yourself.
            Buy ${dropship.length === 1 ? "it" : "them"} in, repackage, and dispatch to the customer.
          </p>
          <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:12px">
            <tr style="text-align:left;color:#64748b">
              <th style="padding:8px">Product</th><th style="padding:8px">Supplier</th>
              <th style="padding:8px">Supplier SKU</th><th style="padding:8px;text-align:right">Qty</th>
            </tr>
            ${rows}
          </table>
          <p style="color:#334155;font-size:13px;margin-top:16px">
            Ship to: <strong>${escapeHtml(order.customer_name ?? "—")}</strong><br>
            ${escapeHtml([order.address, order.city, order.province].filter(Boolean).join(", ") || "—")}<br>
            ${escapeHtml(order.customer_phone ?? "")}
          </p>
        </div>`;

      try {
        const r = await resend.emails.send({
          from: FROM_ADDRESS, to: [emailSetting.value],
          subject: `ACTION: buy ${dropship.length} item${dropship.length === 1 ? "" : "s"} for order ${order.id}`,
          html,
        });
        results.dropship = r;
        await logSend("owner", emailSetting.value, "dropship-action-required",
          r?.error ? "failed" : "sent",
          r?.error ? (r.error.message ?? "resend error") : null,
          (r as any)?.data?.id);
      } catch (e) {
        // Never let this block the customer's confirmation -- they have paid and
        // must be told so even if the internal alert fails.
        await logSend("owner", emailSetting.value, "dropship-action-required", "failed", (e as Error).message);
      }
    }

    // The customer email is queued first and sent second. If Resend is down,
    // the row stays on the queue and process-order-emails retries it with
    // backoff -- the shopper eventually hears from us either way.
    if (order.customer_email) {
      const status: OrderEmailStatus = isOrderEmailStatus(requestedStatus) ? requestedStatus : "confirmation";
      const queued = await enqueueOrderEmail(supabase, order, status);
      results.customer = { queued: queued.queued, reason: queued.reason ?? null, status };

      if (queued.queued && queued.id) {
        const { data: row } = await supabase
          .from("order_email_queue")
          .select("id, order_id, template_status, recipient_email, subject, body_html, attempts, max_attempts")
          .eq("id", queued.id)
          .maybeSingle();
        if (row) {
          const outcome = await deliverQueued(supabase, resend, FROM_ADDRESS, row);
          (results.customer as Record<string, unknown>).delivery = outcome;
          await logSend(
            "customer",
            order.customer_email,
            `order-${status}`,
            outcome === "sent" ? "sent" : "failed",
            outcome === "sent" ? null : "queued for retry",
          );
        }
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
