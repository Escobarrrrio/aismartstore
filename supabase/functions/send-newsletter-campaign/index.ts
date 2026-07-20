import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAuthContext } from "../_shared/auth-guard.ts";
import { resolveEmailFromAddress } from "../_shared/email-from.ts";

Deno.serve(async (req) => {
  const auth = await getAuthContext(req);
  if (!auth.userId || !auth.isAdmin) {
    return new Response(JSON.stringify({ error: "Admin role required" }), {
      status: 403, headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { campaign_id } = await req.json();

  const { data: campaign, error: campaignError } = await supabase
    .from("newsletter_campaigns")
    .select("*")
    .eq("id", campaign_id)
    .single();

  if (campaignError || !campaign) {
    return new Response(JSON.stringify({ status: "error", message: "Campaign not found" }), { status: 404 });
  }

  // Refuse to re-send a campaign that has already been sent.
  if (campaign.status === "sent" || campaign.status === "sending") {
    return new Response(JSON.stringify({ status: "error", message: `Campaign already ${campaign.status}` }), { status: 409 });
  }

  const { data: settingsRows } = await supabase
    .from("store_settings")
    .select("key, value")
    .eq("key", "resend_api_key");
  const resendApiKey = settingsRows?.[0]?.value;

  if (!resendApiKey) {
    return new Response(
      JSON.stringify({ status: "skipped", reason: "resend_api_key not configured in Settings" }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  let query = supabase
    .from("newsletter_subscribers")
    .select("email, unsubscribe_token")
    .is("unsubscribed_at", null);


  if (campaign.category_filter) {
    query = query.contains("interested_categories", [campaign.category_filter]);
  }

  const { data: subscribers } = await query;
  const recipients = subscribers || [];

  await supabase
    .from("newsletter_campaigns")
    .update({ status: "sending", recipient_count: recipients.length })
    .eq("id", campaign_id);

  const fromAddress = await resolveEmailFromAddress(supabase);
  let sent = 0;
  const batchSize = 50;
  for (let i = 0; i < recipients.length; i += batchSize) {
    const batch = recipients.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (r) => {
        const unsubscribeUrl = `https://xwiqubcilptxzvdigsmp.supabase.co/functions/v1/unsubscribe?token=${encodeURIComponent(r.unsubscribe_token)}`;

        const html = `${campaign.body_html}
          <p style="color:#aaa;font-size:11px;margin-top:32px;font-family:sans-serif;">
            AI Smart Store, a division of AI Job Chommie (Pty) Ltd.
            <a href="${unsubscribeUrl}" style="color:#aaa;">Unsubscribe</a>
          </p>`;
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: fromAddress,
            to: r.email,
            subject: campaign.subject,
            html,
          }),
        });
        if (res.ok) sent++;
      })
    );
  }

  await supabase
    .from("newsletter_campaigns")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", campaign_id);

  return new Response(JSON.stringify({ status: "completed", sent, total: recipients.length }), {
    headers: { "Content-Type": "application/json" },
  });
});
