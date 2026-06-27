import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Sends an admin-composed campaign to subscribers, optionally filtered
// by interested category (the personalization layer requested: people
// get the newsletter content relevant to "their wants in their next
// buy" rather than one generic blast to everyone).
//
// Batches sends in groups of 50 to stay well within Resend's rate
// limits rather than firing hundreds of requests in a tight loop.

Deno.serve(async (req) => {
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
    .select("email")
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

  let sent = 0;
  const batchSize = 50;
  for (let i = 0; i < recipients.length; i += batchSize) {
    const batch = recipients.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (r) => {
        const unsubscribeUrl = `https://xwiqubcilptxzvdigsmp.supabase.co/functions/v1/unsubscribe?email=${encodeURIComponent(r.email)}`;
        const html = `${campaign.body_html}
          <p style="color:#aaa;font-size:11px;margin-top:32px;font-family:sans-serif;">
            AI Smart Store, a division of AI Job Chommie (Pty) Ltd.
            <a href="${unsubscribeUrl}" style="color:#aaa;">Unsubscribe</a>
          </p>`;
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: "AI Smart Store <hello@aismartstore.lovable.app>",
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
