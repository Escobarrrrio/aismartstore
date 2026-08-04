// Sends a newsletter campaign.
//
// WHY THIS WAS REWRITTEN
// ----------------------
// Six campaigns had been drafted by the daily digest job and not one had ever
// been sent. Two separate reasons, both structural:
//
//   1. This function required an admin *session*. `build_ai_pulse_digest()`
//      runs from cron, has no session, and therefore had no way to reach it.
//      The digest wrote a draft every morning at 03:30 and stopped there.
//
//   2. Even when reached, it marked the campaign `sent` unconditionally --
//      the final UPDATE ran whether Resend had accepted every message or
//      rejected all of them. `sent` counted successes and was then thrown
//      away. A campaign that reached nobody looked identical to one that
//      reached everybody, which is the failure this store keeps having: not
//      breaking, but reporting success it did not earn.
//
// Both are fixed here. The status now reflects what actually happened, and
// the reason for every rejection is captured rather than discarded.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAuthContext } from "../_shared/auth-guard.ts";
import { resolveEmailFromAddress } from "../_shared/email-from.ts";
import { guard, record } from "../_shared/guardrails.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/** Resend's own per-send cost, in rand. Used for the spend cap pre-check. */
const EMAIL_COST_ZAR = 0.02;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Same three-way auth as the other scheduled functions: the internal cron
  // secret, a service-role bearer, or a signed-in admin. The first is what
  // lets the nightly digest actually go out.
  const internalSecret = Deno.env.get("INTERNAL_CRON_SECRET") ?? "";
  const providedSecret = req.headers.get("x-internal-secret") ?? "";
  const authHeader = req.headers.get("Authorization") ?? "";
  const isInternal =
    (internalSecret.length > 0 && providedSecret === internalSecret) ||
    (serviceKey.length > 0 && authHeader === `Bearer ${serviceKey}`);

  if (!isInternal) {
    const auth = await getAuthContext(req);
    if (!auth.userId || !auth.isAdmin) return json({ error: "Admin role required" }, 403);
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  const body = await req.json().catch(() => ({}));
  const campaignId: string | undefined = body?.campaign_id;
  /** Send only to this address and leave the campaign in draft. */
  const testEmail: string | undefined = typeof body?.test_email === "string" ? body.test_email.trim() : undefined;

  if (!campaignId) return json({ status: "error", message: "campaign_id required" }, 400);

  const { data: campaign, error: campaignError } = await supabase
    .from("newsletter_campaigns")
    .select("*")
    .eq("id", campaignId)
    .single();

  if (campaignError || !campaign) return json({ status: "error", message: "Campaign not found" }, 404);

  // A test send is explicitly allowed against an already-sent campaign -- it
  // goes to one nominated address and changes no state.
  if (!testEmail && (campaign.status === "sent" || campaign.status === "sending")) {
    return json({ status: "error", message: `Campaign already ${campaign.status}` }, 409);
  }

  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!resendApiKey) {
    await supabase.from("automation_events").insert({
      source: "send-newsletter-campaign",
      event_type: "campaign.skipped",
      status: "error",
      error_message: "RESEND_API_KEY not configured — campaign could not be sent.",
      payload: { campaign_id: campaignId },
    });
    return json({ status: "skipped", reason: "RESEND_API_KEY not configured" });
  }

  // Recipients ------------------------------------------------------------
  let recipients: Array<{ email: string; unsubscribe_token: string | null }>;

  if (testEmail) {
    recipients = [{ email: testEmail, unsubscribe_token: null }];
  } else {
    let query = supabase
      .from("newsletter_subscribers")
      .select("email, unsubscribe_token")
      .is("unsubscribed_at", null);
    if (campaign.category_filter) {
      query = query.contains("interested_categories", [campaign.category_filter]);
    }
    const { data: subscribers, error: subErr } = await query;
    if (subErr) return json({ status: "error", message: `Could not load subscribers: ${subErr.message}` }, 500);

    // De-duplicated case-insensitively. Addresses arrived from a free-text
    // field, so the same person had subscribed twice with different casing --
    // two rows, two identical emails, and to the reader that is not a quirk of
    // the database, it is a shop that spams.
    const seen = new Set<string>();
    recipients = [];
    for (const s of subscribers ?? []) {
      const key = (s.email ?? "").trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      recipients.push({ email: s.email, unsubscribe_token: s.unsubscribe_token });
    }
  }

  if (recipients.length === 0) {
    await supabase.from("newsletter_campaigns")
      .update({ status: "sent", sent_at: new Date().toISOString(), recipient_count: 0 })
      .eq("id", campaignId);
    return json({ status: "completed", sent: 0, total: 0, note: "No subscribers matched." });
  }

  // The store-wide email cap applies to newsletters too. A compromised admin
  // session drafting and sending repeatedly is exactly the scenario the caps
  // exist for, and a newsletter is the cheapest way to burn a sending quota.
  const gate = await guard(supabase, {
    provider: "resend-email",
    source: "send-newsletter-campaign",
    estimatedCostZar: EMAIL_COST_ZAR * recipients.length,
  });
  if (!gate.ok) return gate.response!;

  if (!testEmail) {
    await supabase.from("newsletter_campaigns")
      .update({ status: "sending", recipient_count: recipients.length })
      .eq("id", campaignId);
  }

  const fromAddress = await resolveEmailFromAddress(supabase);
  let sent = 0;
  const failures: Array<{ email: string; reason: string }> = [];

  const batchSize = 50;
  for (let i = 0; i < recipients.length; i += batchSize) {
    const batch = recipients.slice(i, i + batchSize);
    await Promise.all(batch.map(async (r) => {
      // Built from the environment rather than a hardcoded project ref, so a
      // restored or migrated project does not mail out unsubscribe links
      // pointing at a database that no longer exists -- which would leave a
      // recipient unable to unsubscribe, and that is a POPIA problem, not a
      // broken link.
      const unsubscribeUrl = r.unsubscribe_token
        ? `${supabaseUrl}/functions/v1/unsubscribe?token=${encodeURIComponent(r.unsubscribe_token)}`
        : `https://aismartstore.co.za/`;

      const html = `${campaign.body_html}
          <p style="color:#aaa;font-size:11px;margin-top:32px;font-family:sans-serif;">
            AI Smart Store, a division of AI Job Chommie (Pty) Ltd.
            <a href="${unsubscribeUrl}" style="color:#aaa;">Unsubscribe</a>
          </p>`;
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: fromAddress,
            to: r.email,
            subject: testEmail ? `[TEST] ${campaign.subject}` : campaign.subject,
            html,
          }),
        });
        if (res.ok) {
          sent++;
        } else {
          const detail = await res.text().catch(() => "");
          failures.push({ email: r.email, reason: `HTTP ${res.status}: ${detail.slice(0, 200)}` });
        }
      } catch (e) {
        failures.push({ email: r.email, reason: String(e).slice(0, 200) });
      }
    }));
  }

  if (sent > 0) {
    await record(supabase, {
      provider: "resend-email",
      source: "send-newsletter-campaign",
      units: sent,
      costZar: EMAIL_COST_ZAR * sent,
      meta: { campaign_id: campaignId, test: Boolean(testEmail) },
    });
  }

  // A test send never advances the campaign -- it exists so the owner can look
  // at the thing before six real people do.
  if (!testEmail) {
    // The status is what happened, not what was attempted. `failed` when
    // nothing landed, `partial` when some did: the previous version wrote
    // `sent` in all three cases, so a campaign that reached nobody was
    // indistinguishable from one that reached everybody.
    const status = sent === 0 ? "failed" : failures.length > 0 ? "partial" : "sent";
    await supabase.from("newsletter_campaigns")
      .update({
        status,
        sent_at: sent > 0 ? new Date().toISOString() : null,
        recipient_count: recipients.length,
      })
      .eq("id", campaignId);

    if (failures.length > 0) {
      console.error("[send-newsletter-campaign] rejections", failures.slice(0, 5));
      await supabase.from("automation_events").insert({
        source: "send-newsletter-campaign",
        event_type: "campaign.delivery_failed",
        status: "error",
        error_message: `${failures.length} of ${recipients.length} recipients rejected. First: ${failures[0].reason}`,
        payload: { campaign_id: campaignId, sent, failed: failures.length, samples: failures.slice(0, 10) },
      });
    }
  }

  return json({
    status: "completed",
    sent,
    total: recipients.length,
    failed: failures.length,
    test: Boolean(testEmail),
    ...(failures.length > 0 ? { firstFailure: failures[0].reason } : {}),
  });
});
