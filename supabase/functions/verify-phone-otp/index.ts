// Verifies the code sent by send-phone-otp against Telnyx's Verify API,
// and on acceptance marks that account's profile as phone_verified.
//
// Auth note: same reasoning as send-phone-otp -- a live session isn't
// guaranteed to exist yet at this point in signup, so `user_id` comes from
// the request body (the client already has it from signUp()'s response),
// cross-checked against any session that IS present. The actual security
// boundary is the OTP code itself: Telnyx only reports "accepted" for the
// exact code it texted to that specific phone number, so knowing the code
// is what proves the phone is really theirs -- the same trust model as a
// mailed password-reset link.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2/cors";
import { getAuthContext } from "../_shared/auth-guard.ts";

const TELNYX_API_KEY = Deno.env.get("TELNYX_API_KEY");
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
  let code: string;
  let userId: string;
  try {
    const body = await req.json();
    phoneNumber = String(body.phone ?? "");
    code = String(body.code ?? "").trim();
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

  const { userId: sessionUserId } = await getAuthContext(req);
  if (sessionUserId && sessionUserId !== userId) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!/^\d{4,8}$/.test(code)) {
    return new Response(JSON.stringify({ error: "Enter the code you received by SMS." }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const telnyxRes = await fetch(
    `https://api.telnyx.com/v2/verifications/by_phone_number/${encodeURIComponent(phoneNumber)}/actions/verify`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TELNYX_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ code, verify_profile_id: VERIFY_PROFILE_ID }),
    }
  );

  if (!telnyxRes.ok) {
    const detail = await telnyxRes.text();
    console.error("Telnyx verify failed", { status: telnyxRes.status, detail, userId });
    return new Response(JSON.stringify({ error: "Couldn't verify that code. Please try again." }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const result = await telnyxRes.json();
  const accepted = result?.data?.response_code === "accepted";
  if (!accepted) {
    return new Response(JSON.stringify({ error: "That code is incorrect or has expired." }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { error: updateError } = await admin
    .from("profiles")
    .update({ phone_verified: true })
    .eq("user_id", userId)
    .eq("phone", phoneNumber);

  if (updateError) {
    console.error("Failed to mark phone verified", { error: updateError, userId });
    return new Response(JSON.stringify({ error: "Verified, but saving failed. Please contact support." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
