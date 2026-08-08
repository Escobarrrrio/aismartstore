import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveEmailFromAddress } from "../_shared/email-from.ts";

// Welcome email — invoked ONLY server-side by the newsletter_subscribers
// AFTER INSERT trigger, using the internal service-role JWT as bearer.
// Direct calls from browsers/attackers are rejected, so this function can no
// longer be abused to send templated email to arbitrary third-party addresses.

const CATEGORY_COPY: Record<string, { headline: string; body: string }> = {
  ai: { headline: "AI & Machine Learning", body: "GPUs, TPUs, and AI accelerators land here first -- often before they're listed on the main catalogue." },
  networking: { headline: "Networking", body: "Routers, switches, and access points for businesses that can't afford downtime." },
  computing: { headline: "Computing", body: "Servers, workstations, and storage sized for real workloads, not just spec sheets." },
  software: { headline: "Software & Licenses", body: "Enterprise and cloud licensing, sourced and priced for South African businesses." },
};

const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  // Authorization: only the DB trigger (or other trusted server) may invoke this.
  const authHeader = req.headers.get("Authorization") ?? "";
  const expected = `Bearer ${SERVICE_ROLE_KEY}`;
  if (authHeader.length !== expected.length || authHeader !== expected) {
    return new Response(JSON.stringify({ status: "error", reason: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    SERVICE_ROLE_KEY
  );

  let body: any = {};
  try { body = await req.json(); } catch {}
  const subscriberId: string | undefined = body?.subscriber_id;
  if (!subscriberId || typeof subscriberId !== "string") {
    return new Response(JSON.stringify({ status: "error", reason: "subscriber_id required" }), { status: 400 });
  }

  const { data: subscriber } = await supabase
    .from("newsletter_subscribers")
    .select("email, interested_categories, subscribed_at, unsubscribed_at, unsubscribe_token")
    .eq("id", subscriberId)
    .maybeSingle();

  if (!subscriber || subscriber.unsubscribed_at) {
    return new Response(JSON.stringify({ status: "skipped", reason: "no active subscription" }), { status: 200 });
  }

  const ageMs = Date.now() - new Date(subscriber.subscribed_at).getTime();
  if (ageMs > 15 * 60 * 1000) {
    return new Response(JSON.stringify({ status: "skipped", reason: "subscription too old for welcome" }), { status: 200 });
  }

  const email = subscriber.email;
  const categories: string[] = subscriber.interested_categories ?? [];

  const resendApiKey = Deno.env.get("RESEND_API_KEY");

  if (!resendApiKey) {
    return new Response(
      JSON.stringify({ status: "skipped", reason: "RESEND_API_KEY not configured" }),
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
    <div style="background:#f4f4f7;padding:32px 12px;font-family:-apple-system,Segoe UI,Roboto,sans-serif;">
    <div style="max-width:560px;margin:0 auto;">
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:18px">
        <tr>
          <td style="vertical-align:middle"><img src="https://aismartstore.co.za/icon-512.png" width="28" height="28" alt="AI Smart Store" style="display:block;border-radius:6px" /></td>
          <td style="vertical-align:middle;padding-left:9px;font-family:Outfit,-apple-system,Segoe UI,sans-serif;font-size:17px;font-weight:800;color:#1a1a2e">Smart Store</td>
        </tr>
      </table>
      <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;padding:28px 24px;">
        <h1 style="font-size:22px;margin:0 0 20px;color:#1a1a2e;">Here's what you just got access to</h1>
        <p style="color:#333;font-size:15px;line-height:1.6;margin:0 0 20px;">
          You're now on the list for early access to new AI hardware, networking gear, and
          enterprise tech -- before it shows up on the main catalogue, and before stock runs out
          on limited items.
        </p>
        ${categoryBlock}
        <a href="https://aismartstore.co.za/products"
           style="display:inline-block;background:linear-gradient(135deg,#06b6d4,#ec4899);color:#fff;
                  text-decoration:none;padding:12px 28px;border-radius:999px;font-weight:600;font-size:14px;margin-top:8px;">
          Browse What's In Stock Now
        </a>
      </div>
      <p style="color:#94a3b8;font-size:11px;margin-top:20px;">
        AI Smart Store, a division of AI Job Chommie (Pty) Ltd. &middot;
        <a href="${Deno.env.get("SUPABASE_URL")}/functions/v1/unsubscribe?token=${encodeURIComponent(subscriber.unsubscribe_token)}" style="color:#94a3b8;">Unsubscribe</a>
      </p>
    </div>
    </div>`;

  const fromAddress = await resolveEmailFromAddress(supabase);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: fromAddress,
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
