import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Welcome email — sends to a NEWLY subscribed email only. Verifies the
// address exists in newsletter_subscribers, was created recently (last
// 15 minutes), and has not been unsubscribed. This prevents the
// function from being abused as an open email relay to arbitrary
// third-party addresses.

const CATEGORY_COPY: Record<string, { headline: string; body: string }> = {
  ai: { headline: "AI & Machine Learning", body: "GPUs, TPUs, and AI accelerators land here first -- often before they're listed on the main catalogue." },
  networking: { headline: "Networking", body: "Routers, switches, and access points for businesses that can't afford downtime." },
  computing: { headline: "Computing", body: "Servers, workstations, and storage sized for real workloads, not just spec sheets." },
  software: { headline: "Software & Licenses", body: "Enterprise and cloud licensing, sourced and priced for South African businesses." },
};

Deno.serve(async (req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { email } = await req.json();
  if (!email || typeof email !== "string") {
    return new Response(JSON.stringify({ status: "error", reason: "email required" }), { status: 400 });
  }

  // SECURITY: only send if this address just subscribed via the site.
  const { data: subscriber } = await supabase
    .from("newsletter_subscribers")
    .select("email, interested_categories, subscribed_at, unsubscribed_at, unsubscribe_token")

    .eq("email", email)
    .maybeSingle();

  if (!subscriber || subscriber.unsubscribed_at) {
    return new Response(JSON.stringify({ status: "skipped", reason: "no active subscription" }), { status: 403 });
  }

  const ageMs = Date.now() - new Date(subscriber.subscribed_at).getTime();
  if (ageMs > 15 * 60 * 1000) {
    return new Response(JSON.stringify({ status: "skipped", reason: "subscription too old for welcome" }), { status: 403 });
  }

  const categories: string[] = subscriber.interested_categories ?? [];

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

  const categoryBlock = categories.length
    ? categories
        .map((c) => CATEGORY_COPY[c])
        .filter(Boolean)
        .map((c) => `<p style="margin:0 0 4px;font-weight:600;color:#1a1a2e;">${c.headline}</p><p style="margin:0 0 16px;color:#555;font-size:14px;">${c.body}</p>`)
        .join("")
    : `<p style="margin:0 0 16px;color:#555;font-size:14px;">You'll hear about new arrivals across AI hardware, networking, computing, and software -- whichever lands first.</p>`;

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;">
      <h1 style="font-size:22px;margin:0 0 4px;color:#1a1a2e;">Here's what you just got access to</h1>
      <p style="color:#888;font-size:13px;margin:0 0 24px;">AI Smart Store</p>
      <p style="color:#333;font-size:15px;line-height:1.6;margin:0 0 20px;">
        You're now on the list for early access to new AI hardware, networking gear, and
        enterprise tech -- before it shows up on the main catalogue, and before stock runs out
        on limited items.
      </p>
      ${categoryBlock}
      <a href="https://aismartstore.lovable.app/products"
         style="display:inline-block;background:linear-gradient(135deg,#06b6d4,#ec4899);color:#fff;
                text-decoration:none;padding:12px 28px;border-radius:999px;font-weight:600;font-size:14px;margin-top:8px;">
        Browse What's In Stock Now
      </a>
      <p style="color:#aaa;font-size:11px;margin-top:32px;">
        AI Smart Store, a division of AI Job Chommie (Pty) Ltd.
        <a href="https://xwiqubcilptxzvdigsmp.supabase.co/functions/v1/unsubscribe?token=${encodeURIComponent(subscriber.unsubscribe_token)}" style="color:#aaa;">Unsubscribe</a>
      </p>
    </div>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "AI Smart Store <hello@aismartstore.lovable.app>",
      to: email,
      subject: "Here's what you just got access to",
      html,
    }),
  });

  const ok = res.ok;
  return new Response(JSON.stringify({ status: ok ? "sent" : "failed" }), {
    status: ok ? 200 : 500,
    headers: { "Content-Type": "application/json" },
  });
});
