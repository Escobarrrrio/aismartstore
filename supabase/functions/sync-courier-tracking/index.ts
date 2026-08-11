// Edge Function: sync-courier-tracking
//
// Closes the fulfillment loop with The Courier Guy (their API platform is
// Shiplogic) in two independent phases:
//
//  Phase A — for paid orders with no tracking number yet, query the courier
//  API for a shipment whose custom reference is our order id and, when one
//  exists, save its tracking number and mark the order shipped.
//
//  Phase B — for ANY order that has a tracking number (whether Phase A
//  found it or an admin typed it into Orders manually) and hasn't had a
//  shipped-notification yet, send the customer a branded "your order has
//  shipped" email via Resend, exactly once (deduped by message_id in
//  email_send_log).
//
// Phase B runs even when no courier API key is configured, so manual
// tracking entry alone is enough to trigger the customer email.
//
// Invoked by pg_cron every 30 minutes (service-role bearer) or on demand
// by an admin.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2/cors";
import { getAuthContext, escapeHtml } from "../_shared/auth-guard.ts";
import { resolveEmailFromAddress } from "../_shared/email-from.ts";
import { withRetry } from "../_shared/retry.ts";
import { startRun, finishRun, deriveRunStatus } from "../_shared/run-log.ts";
import { checkAndAlertOnFailureStreak } from "../_shared/alerts.ts";

/**
 * Pulls a tracking reference out of a Shiplogic (The Courier Guy) shipments
 * API response. The API's own shape varies -- sometimes `{ shipments: [...] }`,
 * sometimes a bare array, sometimes (unexpectedly) a single object under
 * `shipments` -- this normalizes all three. Exported for unit testing.
 */
export function extractTrackingNumber(body: any): string | null {
  const shipment = Array.isArray(body?.shipments)
    ? body.shipments[0]
    : Array.isArray(body)
    ? body[0]
    : body?.shipments ?? null;
  const tracking = shipment?.short_tracking_reference || shipment?.tracking_reference || null;
  return tracking ? String(tracking) : null;
}

const DEFAULT_API_BASE = "https://api.shiplogic.com/v2";
const TRACK_PAGE = "https://portal.thecourierguy.co.za/track-parcel";
const BATCH = 20;

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

function buildShippedHtml(order: any, trackingNumber: string) {
  const trackUrl = `${TRACK_PAGE}?ref=${encodeURIComponent(trackingNumber)}`;
  const orderUrl = `https://aismartstore.co.za/orders/${order.id}`;
  return `
  <div style="background:#f4f4f7;padding:32px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:600px;margin:0 auto">
    ${EMAIL_HEADER}
    <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;padding:28px 24px;color:#0f172a">
      <h1 style="font-size:22px;margin:0 0 8px">Your order is on its way, ${escapeHtml(order.customer_name ?? "")}! 📦</h1>
      <p style="color:#475569;margin:0 0 20px">Order <strong>#${escapeHtml(String(order.id).slice(0, 8))}</strong> has been handed to The Courier Guy.</p>
      <div style="background:#f1f5f9;border-radius:10px;padding:16px;margin:0 0 20px;text-align:center">
        <p style="margin:0 0 6px;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.06em"><strong>Tracking number</strong></p>
        <p style="margin:0;font-size:22px;font-weight:700;font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.06em">${escapeHtml(trackingNumber)}</p>
      </div>
      <div style="text-align:center;margin:0 0 8px">
        <a href="${orderUrl}"
           style="display:inline-block;background:linear-gradient(135deg,#06b6d4,#7c3aed,#d946ef);color:#fff;text-decoration:none;padding:13px 30px;border-radius:999px;font-weight:600;font-size:14px">
          Track My Parcel
        </a>
      </div>
      <p style="color:#64748b;font-size:12px;text-align:center;margin:12px 0 0">
        Or view live courier scan events directly at <a href="${trackUrl}" style="color:#64748b">The Courier Guy</a>.
      </p>
      <p style="color:#64748b;font-size:13px;margin-top:28px">Delivering to: ${escapeHtml(order.address ?? "")}, ${escapeHtml(order.city ?? "")} ${escapeHtml(order.postal_code ?? "")}</p>
    </div>
    ${EMAIL_FOOTER}
  </div>
  </div>`;
}

async function getSetting(supabase: any, key: string): Promise<string> {
  const { data } = await supabase.from("store_settings").select("value").eq("key", key).maybeSingle();
  return ((data?.value as string) ?? "").trim();
}

// Named + assigned and gated behind import.meta.main so test files can
// `import { extractTrackingNumber } from "./index.ts"` without also
// starting an HTTP listener.
const handler = async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Declared outside the try block so the catch handler can still close out
  // the run row (rather than leaving it stuck at status "running" forever)
  // if something throws after startRun() but outside Phase A/B's own
  // per-item try/catches.
  let run: { id: string } | null = null;
  let supabaseForCleanup: any = null;

  try {
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Auth: pg_cron calls with either the pre-shared internal secret (what
    // its cron job actually sends -- see sync-courier-tracking's job
    // definition) or the raw service-role key; humans must be admins.
    // The service-role branch alone turned out to be unreliable in
    // practice -- the Vault copy of that key silently drifted from the
    // live one at some point, so every cron-triggered run was failing with
    // no code-level indication why. The internal-secret branch doesn't
    // depend on keeping a copy of a rotatable platform key in sync.
    const internalSecret = Deno.env.get("INTERNAL_CRON_SECRET") ?? "";
    const providedSecret = req.headers.get("x-internal-secret") ?? "";
    const authHeader = req.headers.get("Authorization") ?? "";
    const isInternal =
      (internalSecret.length > 0 && providedSecret === internalSecret) ||
      authHeader === `Bearer ${serviceKey}`;
    if (!isInternal) {
      const auth = await getAuthContext(req);
      if (!auth.userId || !auth.isAdmin) {
        return new Response(JSON.stringify({ error: "Admin required" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
    supabaseForCleanup = supabase;
    run = await startRun(supabase, "sync-courier-tracking");

    const summary = {
      tracking_found: 0,
      tracking_checked: 0,
      emails_sent: 0,
      emails_failed: 0,
      courier_api_configured: false,
      errors: [] as string[],
      notices: [] as string[],
    };

    // ---------- Phase A: pull tracking numbers from the courier API ----------
    // store_settings (Credential vault) first -- see axiz-sync's comment on
    // the same precedence bug: a stale Deno secret must never silently
    // override what the admin actually entered in Settings.
    const courierKey = (await getSetting(supabase, "courier_guy_api_key")) || Deno.env.get("COURIER_GUY_API_KEY") || "";
    const apiBase = (await getSetting(supabase, "courier_guy_api_base")) || DEFAULT_API_BASE;
    summary.courier_api_configured = Boolean(courierKey);

    if (courierKey) {
      const { data: awaiting } = await supabase
        .from("orders")
        .select("id")
        .eq("payment_status", "paid")
        .is("tracking_number", null)
        .order("created_at", { ascending: true })
        .limit(BATCH);

      for (const o of awaiting ?? []) {
        summary.tracking_checked++;
        try {
          // Retry only network-level failures (timeouts, DNS blips) --
          // an HTTP error status is returned normally and handled below,
          // since 401/403 (bad key) or 404 (no shipment yet) won't
          // succeed on retry and shouldn't be retried 3x per order.
          const res = await withRetry(
            () => fetch(
              `${apiBase}/shipments?custom_tracking_reference=${encodeURIComponent(o.id)}`,
              { headers: { Authorization: `Bearer ${courierKey}` } },
            ),
            { retries: 1, onRetry: (n, e) => console.warn(`[sync-courier-tracking] courier fetch retry ${n} for ${o.id}:`, (e as Error).message) },
          );
          const body = await res.json().catch(() => ({}));
          if (!res.ok) {
            summary.errors.push(`courier api ${res.status} for order ${o.id}`);
            await supabase.from("automation_events").insert({
              source: "courier", event_type: "tracking.fetch_failed", status: "error",
              error_message: `HTTP ${res.status}`,
              payload: { orderId: o.id, apiBase, response: body },
            });
            // A 401/403 means the key itself is bad -- checking further
            // orders this run would just repeat the same failure.
            if (res.status === 401 || res.status === 403) break;
            continue;
          }
          const tracking = extractTrackingNumber(body);
          if (tracking) {
            await supabase.from("orders")
              .update({ tracking_number: String(tracking), order_status: "shipped" })
              .eq("id", o.id);
            await supabase.from("order_audit_log").insert({
              order_id: o.id, actor_email: "sync-courier-tracking",
              event_type: "courier.tracking_synced",
              metadata: { tracking_number: String(tracking), source: "courier_api" },
            });
            summary.tracking_found++;
          }
        } catch (e) {
          summary.errors.push(`courier fetch failed for ${o.id}: ${(e as Error).message}`);
        }
      }
    }

    // ---------- Phase B: shipped email for every tracked, un-notified order ----------
    const resendKey = Deno.env.get("RESEND_API_KEY") || "";
    if (resendKey) {
      const { data: tracked } = await supabase
        .from("orders")
        .select("id, customer_name, customer_email, address, city, postal_code, tracking_number")
        .not("tracking_number", "is", null)
        .order("created_at", { ascending: false })
        .limit(50);

      const candidates = (tracked ?? []).filter((o: any) => o.customer_email && o.tracking_number);
      if (candidates.length) {
        const messageIds = candidates.map((o: any) => `order-shipped-${o.id}-customer`);
        const { data: alreadySent } = await supabase
          .from("email_send_log")
          .select("message_id")
          .in("message_id", messageIds)
          .eq("status", "sent");
        const sentSet = new Set((alreadySent ?? []).map((r: any) => r.message_id));

        const fromAddress = await resolveEmailFromAddress(supabase);
        for (const order of candidates) {
          const messageId = `order-shipped-${order.id}-customer`;
          if (sentSet.has(messageId)) continue;
          try {
            const res = await withRetry(
              () => fetch("https://api.resend.com/emails", {
                method: "POST",
                headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                  from: fromAddress,
                  to: order.customer_email,
                  subject: `Your order is on its way — tracking ${order.tracking_number}`,
                  html: buildShippedHtml(order, order.tracking_number),
                }),
              }),
              { retries: 1, onRetry: (n, e) => console.warn(`[sync-courier-tracking] shipped-email retry ${n} for ${order.id}:`, (e as Error).message) },
            );
            const body = await res.json().catch(() => ({}));
            const ok = res.ok && !body?.error;
            await supabase.from("email_send_log").upsert({
              message_id: messageId, template_name: "order-shipped",
              recipient_email: order.customer_email,
              status: ok ? "sent" : "failed",
              error_message: ok ? null : (body?.error?.message ?? `HTTP ${res.status}`),
              metadata: { orderId: order.id, tracking_number: order.tracking_number, provider_id: body?.id ?? null },
            }, { onConflict: "message_id" });
            await supabase.from("order_audit_log").insert({
              order_id: order.id, actor_email: "sync-courier-tracking",
              event_type: ok ? "email.shipped_sent" : "email.shipped_failed",
              to_value: order.customer_email,
              metadata: { tracking_number: order.tracking_number, error: ok ? null : (body?.error?.message ?? `HTTP ${res.status}`) },
            });
            ok ? summary.emails_sent++ : summary.emails_failed++;
          } catch (e) {
            summary.emails_failed++;
            summary.errors.push(`shipped email failed for ${order.id}: ${(e as Error).message}`);
          }
        }
      }
    } else {
      summary.notices.push("RESEND_API_KEY not configured — shipped emails skipped");
    }

    const totalSynced = summary.tracking_found + summary.emails_sent;
    const totalFailed = summary.errors.length;
    const runStatus = deriveRunStatus(totalSynced, totalFailed);
    await finishRun(supabase, run, {
      status: runStatus,
      items_synced: totalSynced,
      items_failed: totalFailed,
      error_details: summary.errors.length ? summary.errors.join("\n") : null,
    });
    if (runStatus === "failed") {
      await checkAndAlertOnFailureStreak(supabase, "sync-courier-tracking").catch((e) =>
        console.error("[sync-courier-tracking] alert check failed:", (e as Error).message),
      );
    }

    return new Response(JSON.stringify(summary), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[sync-courier-tracking] failure:", error);
    if (run && supabaseForCleanup) {
      await finishRun(supabaseForCleanup, run, {
        status: "failed",
        items_synced: 0,
        items_failed: 1,
        error_details: (error as Error).message,
      });
      await checkAndAlertOnFailureStreak(supabaseForCleanup, "sync-courier-tracking").catch((e) =>
        console.error("[sync-courier-tracking] alert check failed:", (e as Error).message),
      );
    }
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
};

if (import.meta.main) Deno.serve(handler);
