// Sends an alert (email via Resend, optional Slack) once a source's most
// recent runs in `sync_logs` cross a consecutive-failure threshold -- not
// on every failed run after that, so on-call doesn't get paged every 30
// minutes by the same outage. A later success breaks the streak, so
// crossing the threshold again after a recovery re-alerts as a new event.

import { resolveEmailFromAddress } from "./email-from.ts";

export const DEFAULT_FAILURE_THRESHOLD = 3;

async function getNotificationEmail(supabase: any): Promise<string> {
  const { data } = await supabase
    .from("store_settings")
    .select("value")
    .eq("key", "notification_email")
    .maybeSingle();
  return ((data?.value as string) ?? "").trim();
}

function buildAlertHtml(source: string, streak: number, lastError: string | null): string {
  const safeError = lastError ? lastError.replace(/</g, "&lt;").replace(/>/g, "&gt;") : "";
  return `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:24px">
    <h1 style="font-size:18px;color:#b91c1c;margin:0 0 12px">&#9888;&#65039; ${source} has failed ${streak} times in a row</h1>
    <p style="color:#334155;font-size:14px;line-height:1.6">
      The <strong>${source}</strong> edge function has now failed its last ${streak} runs.
      This alert fires once per failure streak -- it will fire again only if it fails
      ${streak} more times after a recovery.
    </p>
    ${safeError ? `<pre style="background:#f1f5f9;border-radius:8px;padding:12px;font-size:12px;white-space:pre-wrap;color:#0f172a">${safeError}</pre>` : ""}
    <p style="color:#64748b;font-size:12px;margin-top:20px">Check Admin &rarr; Sync Health for full run history.</p>
  </div>`;
}

async function sendSlackAlert(webhookUrl: string, source: string, streak: number, lastError: string | null): Promise<boolean> {
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `:rotating_light: *${source}* has failed *${streak}* times in a row.${
          lastError ? `\n\`\`\`${lastError.slice(0, 500)}\`\`\`` : ""
        }`,
      }),
    });
    return res.ok;
  } catch (e) {
    console.error(`[alerts] Slack webhook failed:`, (e as Error).message);
    return false;
  }
}

/**
 * Call after logging a failed run. Looks at the source's recent sync_logs
 * history; if the last `threshold` runs are all failures and no alert has
 * been sent yet for this streak, sends email/Slack and records an
 * automation_events row so the next failed run in the same streak doesn't
 * re-alert.
 */
export async function checkAndAlertOnFailureStreak(
  supabase: any,
  source: string,
  threshold: number = DEFAULT_FAILURE_THRESHOLD,
): Promise<void> {
  const { data: recent } = await supabase
    .from("sync_logs")
    .select("id, status, started_at, error_details")
    .eq("source", source)
    .order("started_at", { ascending: false })
    .limit(threshold);

  const runs = recent ?? [];
  if (runs.length < threshold) return;
  const allFailed = runs.every((r: any) => r.status === "failed" || r.status === "error");
  if (!allFailed) return;

  // Oldest run in the streak we're looking at -- an alert already sent for
  // (or after) this point means this exact streak has been reported.
  const streakStart = runs[runs.length - 1].started_at;
  const { data: alreadyAlerted } = await supabase
    .from("automation_events")
    .select("id")
    .eq("source", source)
    .eq("event_type", "alert_sent")
    .gte("created_at", streakStart)
    .limit(1)
    .maybeSingle();
  if (alreadyAlerted) return;

  const lastError = runs[0]?.error_details ?? null;
  const recipient = await getNotificationEmail(supabase);
  const resendKey = Deno.env.get("RESEND_API_KEY") || "";
  let emailSent = false;

  if (recipient && resendKey) {
    try {
      const fromAddress = await resolveEmailFromAddress(supabase);
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: fromAddress,
          to: recipient,
          subject: `⚠️ ${source} has failed ${threshold} times in a row`,
          html: buildAlertHtml(source, threshold, lastError),
        }),
      });
      emailSent = res.ok;
    } catch (e) {
      console.error(`[alerts] email send failed:`, (e as Error).message);
    }
  }

  const slackWebhook = Deno.env.get("SLACK_WEBHOOK_URL") || "";
  const slackSent = slackWebhook ? await sendSlackAlert(slackWebhook, source, threshold, lastError) : false;

  await supabase.from("automation_events").insert({
    source,
    event_type: "alert_sent",
    status: "sent",
    payload: { threshold, emailSent, slackSent, recipient: recipient || null },
  });
}
