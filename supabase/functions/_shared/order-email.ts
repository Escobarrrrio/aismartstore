/**
 * Customer order emails: editable templates + a durable queue.
 *
 * Two failures used to be possible and both were silent to the shopper:
 *   1. copy for a fulfilment status was hard-coded in the function, so
 *      changing "your order is packed" meant a code deploy, and
 *   2. a Resend hiccup during a status change lost the notification for
 *      good -- the admin saw "customer notified", the customer saw nothing.
 *
 * Everything here is therefore template-driven (public.order_email_templates,
 * editable in the admin) and queued (public.order_email_queue) before a single
 * network call is made. The send attempt is best-effort; whatever is still
 * `queued` gets picked up by process-order-emails with exponential backoff.
 */

export const ORDER_EMAIL_STATUSES = [
  "confirmation",
  "pending",
  "paid",
  "packed",
  "shipped",
  "delivered",
  "returned",
  "cancelled",
] as const;

export type OrderEmailStatus = (typeof ORDER_EMAIL_STATUSES)[number];

export function isOrderEmailStatus(v: unknown): v is OrderEmailStatus {
  return typeof v === "string" && (ORDER_EMAIL_STATUSES as readonly string[]).includes(v);
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string),
  );
}

/**
 * Placeholders whose value is already trusted HTML we generated ourselves.
 * Everything else is escaped, so an admin editing a template can never turn
 * a customer name into markup.
 */
const RAW_KEYS = new Set(["items_table"]);

export function renderTemplate(source: string, vars: Record<string, unknown>): string {
  return String(source ?? "").replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_m, key: string) => {
    const k = key.toLowerCase();
    if (!(k in vars)) return "";
    return RAW_KEYS.has(k) ? String(vars[k] ?? "") : escapeHtml(vars[k]);
  });
}

/** Class names templates may use, mapped to inline styles for email clients. */
const CLASS_STYLES: Record<string, string> = {
  panel: "background:#f1f5f9;border-radius:10px;padding:14px 16px;margin:0 0 20px",
  caption: "margin:0 0 4px;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.06em;font-weight:700",
  strong: "margin:0;font-size:16px;font-weight:600",
  muted: "color:#64748b;font-size:13px;margin:6px 0 0",
  total: "margin-top:24px;font-size:18px;font-weight:700",
};

/** Inline the tiny class vocabulary above; Gmail strips <style> blocks. */
export function inlineClasses(html: string): string {
  return html.replace(/class="([a-z ]+)"/gi, (_m, names: string) => {
    const style = names
      .split(/\s+/)
      .map((n) => CLASS_STYLES[n])
      .filter(Boolean)
      .join(";");
    return style ? `style="${style}"` : "";
  });
}

const HEADER = `
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:18px">
    <tr>
      <td style="vertical-align:middle"><img src="https://aismartstore.co.za/icon-512.png" width="28" height="28" alt="AI Smart Store" style="display:block;border-radius:6px" /></td>
      <td style="vertical-align:middle;padding-left:9px;font-family:Outfit,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:17px;font-weight:800;color:#0f172a">Smart Store</td>
    </tr>
  </table>`;

const FOOTER = `
  <p style="margin:24px 0 0;font-size:11px;color:#94a3b8;line-height:1.5;border-top:1px solid #e2e8f0;padding-top:16px">
    AI Smart Store, a division of AI Job Chommie (Pty) Ltd. &middot; <a href="https://aismartstore.co.za" style="color:#94a3b8">aismartstore.co.za</a>
  </p>`;

export function wrapEmail(inner: string): string {
  return `
  <div style="background:#f4f4f7;padding:32px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:600px;margin:0 auto">
    ${HEADER}
    <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;padding:28px 24px;color:#0f172a">
      ${inlineClasses(inner)}
    </div>
    ${FOOTER}
  </div>
  </div>`;
}

export function formatZAR(value: number): string {
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(value || 0);
}

// deno-lint-ignore no-explicit-any
export function buildItemsTable(order: any): string {
  const items = (order?.order_items ?? []) as any[];
  if (items.length === 0) return "";
  const rows = items
    .map(
      (i) => `
      <tr style="border-bottom:1px solid #f1f5f9">
        <td style="padding:8px 0">${escapeHtml(i.products?.name ?? "Product")}</td>
        <td align="right" style="padding:8px 0">${escapeHtml(i.quantity)}</td>
        <td align="right" style="padding:8px 0">${escapeHtml(formatZAR(Number(i.unit_price)))}</td>
      </tr>`,
    )
    .join("");
  return `<table style="width:100%;border-collapse:collapse;border-top:1px solid #e2e8f0">
      <thead><tr><th align="left" style="padding:8px 0">Item</th><th align="right" style="padding:8px 0">Qty</th><th align="right" style="padding:8px 0">Price</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// deno-lint-ignore no-explicit-any
export function estimatedDeliveryLabel(order: any): string {
  const items = (order?.order_items ?? []) as any[];
  const anyBackorder = items.some((i) => (i.products?.stock_quantity ?? 0) < i.quantity);
  const addDays = (d: Date, n: number) => {
    const c = new Date(d);
    c.setDate(c.getDate() + n);
    return c;
  };
  const start = new Date();
  const from = addDays(start, anyBackorder ? 5 : 2);
  const to = addDays(start, anyBackorder ? 12 : 7);
  const fmt = (d: Date) => d.toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" });
  return `${fmt(from)} – ${fmt(to)}${anyBackorder ? " (backorder)" : ""}`;
}

// deno-lint-ignore no-explicit-any
export function buildVars(order: any): Record<string, unknown> {
  return {
    customer_name: order?.customer_name ?? "there",
    order_id: order?.id ?? "",
    order_short: String(order?.id ?? "").slice(0, 8).toUpperCase(),
    total: formatZAR(Number(order?.total_amount)),
    status: order?.order_status ?? order?.status ?? "pending",
    tracking: order?.tracking_number || "Tracking number follows shortly",
    eta: estimatedDeliveryLabel(order),
    shipping_address: [order?.address, order?.city, order?.province, order?.postal_code]
      .filter(Boolean)
      .join(", "),
    items_table: buildItemsTable(order),
  };
}

/** 1m, 5m, 15m, 45m, 2h15 -- fast enough to beat a blip, slow enough to survive an outage. */
export function backoffMinutes(attempt: number): number {
  return Math.min(135, 1 * Math.pow(3, Math.max(0, attempt - 1)));
}

export interface QueueRow {
  id: string;
  order_id: string;
  template_status: string;
  recipient_email: string;
  subject: string;
  body_html: string;
  attempts: number;
  max_attempts: number;
}

export interface QueueResult {
  queued: boolean;
  reason?: string;
  id?: string;
}

/**
 * Render the editable template for `status` and put it on the queue.
 * Returns `{ queued: false }` when the template is disabled/missing or the
 * order has no email -- both are normal, neither is an error.
 */
export async function enqueueOrderEmail(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  // deno-lint-ignore no-explicit-any
  order: any,
  status: OrderEmailStatus,
): Promise<QueueResult> {
  if (!order?.customer_email) return { queued: false, reason: "no_recipient" };

  const { data: tpl } = await supabase
    .from("order_email_templates")
    .select("subject, body_html, enabled")
    .eq("status", status)
    .maybeSingle();

  if (!tpl) return { queued: false, reason: "no_template" };
  if (tpl.enabled === false) return { queued: false, reason: "template_disabled" };

  const vars = buildVars(order);
  const subject = renderTemplate(tpl.subject, vars);
  const body_html = wrapEmail(renderTemplate(tpl.body_html, vars));

  // One row per (order, status, attempt-of-the-same-minute): a double-click on
  // "Mark shipped" must not send two emails, but a genuine re-send later must.
  const bucket = new Date().toISOString().slice(0, 16);
  const idempotency_key = `${order.id}:${status}:${bucket}`;

  const { data, error } = await supabase
    .from("order_email_queue")
    .upsert(
      {
        order_id: order.id,
        template_status: status,
        recipient_email: order.customer_email,
        subject,
        body_html,
        status: "queued",
        idempotency_key,
      },
      { onConflict: "idempotency_key", ignoreDuplicates: true },
    )
    .select("id")
    .maybeSingle();

  if (error) return { queued: false, reason: error.message };
  if (!data) return { queued: false, reason: "duplicate" };
  return { queued: true, id: data.id };
}

/**
 * Try to deliver one queued row. Never throws: a transport failure schedules
 * the next attempt, exhaustion parks the row as `failed` for the admin to see.
 */
export async function deliverQueued(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  // deno-lint-ignore no-explicit-any
  resend: any,
  from: string,
  row: QueueRow,
): Promise<"sent" | "retry" | "failed"> {
  const attempts = row.attempts + 1;
  let errorMessage: string | null = null;
  let providerId: string | null = null;

  try {
    const r = await resend.emails.send({
      from,
      to: [row.recipient_email],
      subject: row.subject,
      html: row.body_html,
    });
    if (r?.error) errorMessage = r.error.message ?? "resend error";
    else providerId = r?.data?.id ?? null;
  } catch (e) {
    errorMessage = (e as Error).message;
  }

  if (!errorMessage) {
    await supabase
      .from("order_email_queue")
      .update({ status: "sent", attempts, sent_at: new Date().toISOString(), provider_message_id: providerId, last_error: null })
      .eq("id", row.id);
    await logSend(supabase, row, "sent", null, providerId);
    return "sent";
  }

  const exhausted = attempts >= row.max_attempts;
  await supabase
    .from("order_email_queue")
    .update({
      status: exhausted ? "failed" : "queued",
      attempts,
      last_error: errorMessage,
      next_attempt_at: new Date(Date.now() + backoffMinutes(attempts) * 60_000).toISOString(),
    })
    .eq("id", row.id);
  await logSend(supabase, row, "failed", errorMessage, null);
  return exhausted ? "failed" : "retry";
}

async function logSend(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  row: QueueRow,
  status: "sent" | "failed",
  error_message: string | null,
  providerId: string | null,
) {
  await supabase.from("email_send_log").insert({
    message_id: providerId ?? `order-${row.order_id}-${row.template_status}-${row.id}`,
    template_name: `order-${row.template_status}`,
    recipient_email: row.recipient_email,
    status,
    error_message,
    metadata: { order_id: row.order_id, queue_id: row.id },
  });
}
