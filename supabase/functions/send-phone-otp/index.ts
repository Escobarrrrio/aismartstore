// Sends a 6-digit SMS verification code via Telnyx's Verify API. Telnyx
// owns the OTP lifecycle (generation, expiry, attempt limits) -- this
// function only proxies the request so the Telnyx API key never reaches
// the browser.
//
// Budget guardrails (per spec): SMS only ever goes to +27 numbers -- this
// mirrors the client-side gate in Auth.tsx, but is re-checked here since
// the client-side check is trivially bypassable and Telnyx costs real
// promo balance. Every attempt (sent or rejected) is logged to
// sms_send_log, which also backs the 60-second resend cooldown.
//
// Auth note: this runs at signup time, where a live session doesn't always
// exist yet -- if email confirmation is required, signUp() returns
// data.user (the row exists) but data.session is null until the email is
// confirmed, and this phone step happens before that. So instead of
// requiring a Bearer session, the caller supplies `user_id` (which the
// client already has straight from signUp()'s response) and this function
// checks it against a real, not-yet-verified profile row -- when a session
// *is* present (the OAuth path always has one), it's cross-checked too.
// The real security boundary is the OTP code itself in verify-phone-otp:
// nothing here marks an account verified, it only sends a text.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2/cors";
import { getAuthContext } from "../_shared/auth-guard.ts";

const TELNYX_API_KEY = Deno.env.get("TELNYX_API_KEY");
// Created via the Telnyx Verify Profiles API -- "AI Smart Store - Phone
// Verification", SMS channel, 6-digit code, 5 minute expiry.
const VERIFY_PROFILE_ID = "4900019f-99f4-36c7-4ce3-e2051cafb332";
const RESEND_COOLDOWN_SECS = 60;

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (!TELNYX_API_KEY) {
    console.error("TELNYX_API_KEY not configured");
    return jsonResponse({ error: "Phone verification is not configured yet" }, 500);
  }

  let phoneNumber: string;
  let userId: string;
  try {
    const body = await req.json();
    phoneNumber = String(body.phone ?? "");
    userId = String(body.user_id ?? "");
  } catch {
    return jsonResponse({ error: "Invalid request body" }, 400);
  }

  if (!userId) return jsonResponse({ error: "Missing user_id" }, 400);

  // If a session was sent, it must belong to the account being verified --
  // this is what stops the OAuth path (which always has a session) from
  // triggering OTPs for someone else's account.
  const { userId: sessionUserId } = await getAuthContext(req);
  if (sessionUserId && sessionUserId !== userId) return jsonResponse({ error: "Forbidden" }, 403);

  // Budget guardrail: SA-only SMS. Anything else should never have reached
  // here (the frontend routes non-+27 numbers to the email-fallback path
  // instead), so this is a defensive reject, not the primary UX.
  if (!phoneNumber.startsWith("+27")) {
    return jsonResponse({ error: "SMS verification is currently restricted to South African (+27) numbers." }, 400);
  }
  if (!/^\+27\d{9}$/.test(phoneNumber)) {
    return jsonResponse({ error: "Invalid phone number format" }, 400);
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: profile } = await admin
    .from("profiles")
    .select("user_id, phone, is_phone_verified")
    .eq("user_id", userId)
    .maybeSingle();

  if (!profile || profile.is_phone_verified || profile.phone !== phoneNumber) {
    return jsonResponse({ error: "Nothing pending verification for that number" }, 403);
  }

  // Rate limit: max one send per RESEND_COOLDOWN_SECS per user, enforced
  // server-side against sms_send_log (a client-side timer alone can't stop
  // a page refresh or a second tab).
  const { data: lastSend } = await admin
    .from("sms_send_log")
    .select("created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastSend) {
    const elapsedSecs = (Date.now() - new Date(lastSend.created_at).getTime()) / 1000;
    if (elapsedSecs < RESEND_COOLDOWN_SECS) {
      const waitSecs = Math.ceil(RESEND_COOLDOWN_SECS - elapsedSecs);
      return jsonResponse({ error: `Please wait ${waitSecs}s before requesting another code.`, retryAfterSecs: waitSecs }, 429);
    }
  }

  let telnyxRes: Response;
  try {
    telnyxRes = await fetch("https://api.telnyx.com/v2/verifications/sms", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TELNYX_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ phone_number: phoneNumber, verify_profile_id: VERIFY_PROFILE_ID }),
    });
  } catch (networkError) {
    await admin.from("sms_send_log").insert({
      user_id: userId,
      phone: phoneNumber,
      status: "failed",
      error_message: String(networkError),
    });
    console.error("Telnyx request failed (network)", { error: networkError, userId });
    return jsonResponse({ error: "Service temporarily busy, please try again." }, 502);
  }

  if (!telnyxRes.ok) {
    const detail = await telnyxRes.text();
    await admin.from("sms_send_log").insert({
      user_id: userId,
      phone: phoneNumber,
      status: "failed",
      telnyx_status_code: telnyxRes.status,
      error_message: detail.slice(0, 2000),
    });
    console.error("Telnyx send verification failed", { status: telnyxRes.status, detail, userId });
    // 401 = bad/missing API key, 422 = malformed request -- neither is the
    // user's fault, so the message stays generic rather than leaking why.
    return jsonResponse({ error: "Service temporarily busy, please try again." }, 502);
  }

  await admin.from("sms_send_log").insert({
    user_id: userId,
    phone: phoneNumber,
    status: "sent",
    telnyx_status_code: telnyxRes.status,
  });

  return jsonResponse({ success: true }, 200);
});
