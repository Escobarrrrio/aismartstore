// Verifies the code sent by send-phone-otp against Telnyx's Verify API,
// and on acceptance marks that account's profile as is_phone_verified.
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
  let code: string;
  let userId: string;
  try {
    const body = await req.json();
    phoneNumber = String(body.phone ?? "");
    code = String(body.code ?? "").trim();
    userId = String(body.user_id ?? "");
  } catch {
    return jsonResponse({ error: "Invalid request body" }, 400);
  }

  if (!userId) return jsonResponse({ error: "Missing user_id" }, 400);

  const { userId: sessionUserId } = await getAuthContext(req);
  if (sessionUserId && sessionUserId !== userId) return jsonResponse({ error: "Forbidden" }, 403);

  if (!/^\d{4,8}$/.test(code)) {
    return jsonResponse({ error: "Enter the code you received by SMS." }, 400);
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let telnyxRes: Response;
  try {
    telnyxRes = await fetch(
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
  } catch (networkError) {
    await admin.from("sms_send_log").insert({
      user_id: userId,
      phone: phoneNumber,
      purpose: "phone_verification_check",
      status: "failed",
      error_message: String(networkError),
    });
    console.error("Telnyx verify request failed (network)", { error: networkError, userId });
    return jsonResponse({ error: "Service temporarily busy, please try again." }, 502);
  }

  if (!telnyxRes.ok) {
    const detail = await telnyxRes.text();
    await admin.from("sms_send_log").insert({
      user_id: userId,
      phone: phoneNumber,
      purpose: "phone_verification_check",
      status: "failed",
      telnyx_status_code: telnyxRes.status,
      error_message: detail.slice(0, 2000),
    });
    console.error("Telnyx verify failed", { status: telnyxRes.status, detail, userId });
    // 401 = bad/missing API key, 422 = malformed request -- neither is the
    // user's fault, so the message stays generic rather than leaking why.
    return jsonResponse({ error: "Service temporarily busy, please try again." }, 502);
  }

  const result = await telnyxRes.json();
  const accepted = result?.data?.response_code === "accepted";
  if (!accepted) {
    return jsonResponse({ error: "That code is incorrect or has expired." }, 400);
  }

  const { error: updateError } = await admin
    .from("profiles")
    .update({ is_phone_verified: true })
    .eq("user_id", userId)
    .eq("phone", phoneNumber);

  if (updateError) {
    console.error("Failed to mark phone verified", { error: updateError, userId });
    return jsonResponse({ error: "Verified, but saving failed. Please contact support." }, 500);
  }

  return jsonResponse({ success: true }, 200);
});
