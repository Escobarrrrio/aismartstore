// Immediate alerting for payment-webhook failures.
//
// Distinct from checkAndAlertOnFailureStreak in ./alerts.ts, which is built for
// scheduled jobs and deliberately waits for a run of consecutive failures so a
// flaky cron doesn't page anyone. That is the wrong shape for a payment
// webhook: one rejected signature or one untrusted source IP is either an
// attack or a misconfiguration that is silently losing money, and it needs to
// be visible the first time it happens.
//
// De-duplicated by (source, kind) over a short window so a burst of retries
// from the same broken caller sends one alert rather than fifty.

import { resolveEmailFromAddress } from "./email-from.ts";

/** Minutes to suppress repeat alerts for the same source+kind. */
export const ALERT_DEDUPE_MINUTES = 15;

export type WebhookAlertKind =
  | "signature_invalid"
  | "ip_rejected"
  | "server_validation_failed"
  | "amount_mismatch"
  | "handler_error"
  | "unknown_order";

/** Alert kinds that indicate tampering or a hostile caller rather than a bug. */
const SECURITY_KINDS: ReadonlySet<WebhookAlertKind> = new Set([
  "signature_invalid",
  "ip_rejected",
  "amount_mismatch",
]);

async function getNotificationEmail(supabase: any): Promise<string> {
  const { data } = await supabase
    .from("store_settings").select("value")
    .eq("key", "notification_email").maybeSingle();
  return ((data?.value as string) ?? "").trim();
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function buildHtml(source: string, kind: WebhookAlertKind, detail: string, context: Record<string, unknown>): string {
  const isSecurity = SECURITY_KINDS.has(kind);
  const rows = Object.entries(context)
    .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#64748b">${esc(k)}</td><td style="padding:4px 0;font-family:monospace">${esc(String(v ?? "—"))}</td></tr>`)
    .join("");
  return `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:24px">
    <h1 style="font-size:18px;color:#b91c1c;margin:0 0 12px">
      ${isSecurity ? "&#128680; Security" : "&#9888;&#65039;"} ${esc(source)}: ${esc(kind)}
    </h1>
    <p style="color:#334155;font-size:14px;line-height:1.6">${esc(detail)}</p>
    ${rows ? `<table style="font-size:13px;border-collapse:collapse;margin-top:8px">${rows}</table>` : ""}
    <p style="color:#64748b;font-size:12px;margin-top:20px">
      ${isSecurity
        ? "A payment callback failed verification. If you are not currently testing, treat this as untrusted traffic hitting your webhook."
        : "A payment callback could not be processed. The customer may have paid without their order being updated."}
      Full detail is in the <strong>payment_events</strong> table.
    </p>
    <p style="color:#64748b;font-size:12px">Repeat alerts for this same problem are suppressed for ${ALERT_DEDUPE_MINUTES} minutes.</p>
  </div>`;
}

async function sendSlack(webhookUrl: string, source: string, kind: WebhookAlertKind, detail: string): Promise<boolean> {
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `:rotating_light: *${source}* — \`${kind}\`\n${detail.slice(0, 500)}`,
      }),
    });
    return res.ok;
  } catch (e) {
    console.error("[webhook-alerts] Slack failed:", (e as Error).message);
    return false;
  }
}

/**
 * Fire an alert for a webhook failure, at most once per source+kind per
 * ALERT_DEDUPE_MINUTES. Never throws: alerting must not be able to break
 * payment processing, so every failure here is logged and swallowed.
 */
export async function alertWebhookFailure(
  supabase: any,
  source: string,
  kind: WebhookAlertKind,
  detail: string,
  context: Record<string, unknown> = {},
): Promise<void> {
  try {
    const since = new Date(Date.now() - ALERT_DEDUPE_MINUTES * 60_000).toISOString();
    const { data: recent } = await supabase
      .from("automation_events")
      .select("id")
      .eq("source", source)
      .eq("event_type", `alert.${kind}`)
      .gte("created_at", since)
      .limit(1)
      .maybeSingle();
    if (recent) return;

    const recipient = await getNotificationEmail(supabase);
    const resendKey = Deno.env.get("RESEND_API_KEY") || "";
    const slackUrl = Deno.env.get("SLACK_ALERT_WEBHOOK_URL") || "";
    let emailSent = false;
    let slackSent = false;

    if (recipient && resendKey) {
      try {
        const from = await resolveEmailFromAddress(supabase);
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from,
            to: [recipient],
            subject: `[${source}] ${kind}`,
            html: buildHtml(source, kind, detail, context),
          }),
        });
        emailSent = res.ok;
      } catch (e) {
        console.error("[webhook-alerts] email failed:", (e as Error).message);
      }
    }

    if (slackUrl) slackSent = await sendSlack(slackUrl, source, kind, detail);

    // Written even when both channels fail, so the dedupe window still holds
    // and a broken mailer can't turn one incident into an alert storm.
    await supabase.from("automation_events").insert({
      source,
      event_type: `alert.${kind}`,
      status: emailSent || slackSent ? "success" : "failed",
      error_message: detail,
      payload: { kind, context, emailSent, slackSent },
    });
  } catch (e) {
    console.error("[webhook-alerts] alerting failed:", (e as Error).message);
  }
}
