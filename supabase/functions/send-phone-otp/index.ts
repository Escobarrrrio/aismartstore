// Sends a 6-digit SMS verification code via Telnyx's Verify API. Telnyx
// owns the OTP lifecycle (generation, expiry, attempt limits) -- this
// function only proxies the request so the Telnyx API key never reaches
// the browser.
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (!TELNYX_API_KEY) {
    console.error("TELNYX_API_KEY not configured");
    return new Response(JSON.stringify({ error: "Phone verification is not configured yet" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let phoneNumber: string;
  let userId: string;
  try {
    const body = await req.json();
    phoneNumber = String(body.phone ?? "");
    userId = String(body.user_id ?? "");
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!userId) {
    return new Response(JSON.stringify({ error: "Missing user_id" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // If a session was sent, it must belong to the account being verified --
  // this is what stops the OAuth path (which always has a session) from
  // triggering OTPs for someone else's account.
  const { userId: sessionUserId } = await getAuthContext(req);
  if (sessionUserId && sessionUserId !== userId) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Basic E.164 sanity check -- the real validation (country-aware) already
  // happened client-side via libphonenumber-js before this was called.
  if (!/^\+[1-9]\d{6,14}$/.test(phoneNumber)) {
    return new Response(JSON.stringify({ error: "Invalid phone number format" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: profile } = await admin
    .from("profiles")
    .select("user_id, phone, phone_verified")
    .eq("user_id", userId)
    .maybeSingle();

  if (!profile || profile.phone_verified || profile.phone !== phoneNumber) {
    return new Response(JSON.stringify({ error: "Nothing pending verification for that number" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const telnyxRes = await fetch("https://api.telnyx.com/v2/verifications/sms", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TELNYX_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ phone_number: phoneNumber, verify_profile_id: VERIFY_PROFILE_ID }),
  });

  if (!telnyxRes.ok) {
    const detail = await telnyxRes.text();
    console.error("Telnyx send verification failed", { status: telnyxRes.status, detail, userId });
    return new Response(JSON.stringify({ error: "Couldn't send verification code. Please try again." }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
