import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// =====================================================================
// Welcome email -- sent once, immediately on signup.
//
// Why this email matters more than any later campaign: welcome emails
// average 50-86% open rates industry-wide (vs. ~15-25% for regular
// campaigns) because the subscriber's intent is highest in the seconds
// right after they act. This is the single highest-leverage message in
// the whole sequence, so the structure here is deliberate:
//
// 1. SUBJECT LINE -- specific + curiosity-gap, not generic "Welcome!".
//    "Welcome to AI Smart Store" tells the brain nothing worth opening
//    for. "Here's what you just got access to" implies a concrete,
//    already-existing benefit and creates an information gap (Loewenstein's
//    curiosity-gap theory) the reader resolves by opening.
//
// 2. RECIPROCITY, FIRST -- the email leads by giving (a clear answer to
//    "what do I get"), before ever asking for anything back. This is
//    Cialdini's reciprocity principle: people feel obliged to reciprocate
//    a genuine gift, and a sense of being given something first builds
//    goodwill before any sales ask appears.
//
// 3. ONE CTA -- a single, unambiguous next action ("Browse AI & Hardware"
//    or similar). Split-test literature on email design consistently
//    shows single-CTA emails outperform multi-CTA ones -- every extra
//    choice is a chance to choose nothing (Hick's Law / choice paralysis).
//
// 4. HONEST PERSONALIZATION -- if the subscriber picked categories,
//    the email speaks directly to that interest instead of generic copy.
//    Generic mass email reads as mass email; specific copy reads as
//    being seen.
//
// 5. NO FAKE URGENCY -- deliberately does not invent a countdown timer
//    or fabricated "only 3 left" claim. Manufactured scarcity is a
//    well-known dark pattern that erodes trust once noticed, and the
//    backfire risk outweighs any short-term lift. Real urgency (genuine
//    stock levels, genuine price changes) is used elsewhere in the
//    product/cart UI where it's actually true -- never invented here.
// =====================================================================

const CATEGORY_COPY: Record<string, { headline: string; body: string }> = {
  ai: {
    headline: "AI & Machine Learning",
    body: "GPUs, TPUs, and AI accelerators land here first -- often before they're listed on the main catalogue.",
  },
  networking: {
    headline: "Networking",
    body: "Routers, switches, and access points for businesses that can't afford downtime.",
  },
  computing: {
    headline: "Computing",
    body: "Servers, workstations, and storage sized for real workloads, not just spec sheets.",
  },
  software: {
    headline: "Software & Licenses",
    body: "Enterprise and cloud licensing, sourced and priced for South African businesses.",
  },
};

Deno.serve(async (req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { email, categories } = await req.json();

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

  const cats: string[] = Array.isArray(categories) ? categories : [];
  const categoryBlock = cats.length
    ? cats
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
        <a href="https://xwiqubcilptxzvdigsmp.supabase.co/functions/v1/unsubscribe?email=${encodeURIComponent(email)}" style="color:#aaa;">Unsubscribe</a>
      </p>
    </div>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
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
