// Single source of truth for the "From" address every Resend-sent email
// uses (order notifications, welcome email, newsletter). Previously each
// function hardcoded its own value independently -- notify-order fell back
// to Resend's own shared orders@resend.dev, while send-welcome-email and
// send-newsletter-campaign hardcoded hello@ the old preview domain. Both
// are unverified-domain sends that fail SPF/DMARC checks at strict
// providers (Yahoo, Gmail) and land in spam -- which is the whole reason
// this file exists. Fix it once, in one place, via Admin -> Settings.

const UNVERIFIED_FALLBACK = "AI Smart Store <orders@resend.dev>";

export async function resolveEmailFromAddress(supabase: any): Promise<string> {
  const { data } = await supabase
    .from("store_settings")
    .select("value")
    .eq("key", "email_from_address")
    .maybeSingle();

  const configured = (data?.value as string | undefined)?.trim();
  if (configured) return configured;

  // Don't fail the send, but make the degraded state loudly visible --
  // this exact silence (a "successful" send from an unauthenticated
  // domain, discovered only when someone happens to check their spam
  // folder) is the recurring problem being fixed here.
  await supabase.from("automation_events").insert({
    source: "email",
    event_type: "from_address.unverified",
    status: "error",
    error_message: "email_from_address not configured in Admin Settings -- sending from an unverified fallback domain, which will likely land in spam.",
    payload: { fallback: UNVERIFIED_FALLBACK },
  });

  return UNVERIFIED_FALLBACK;
}
