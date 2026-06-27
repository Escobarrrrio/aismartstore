import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2/cors";

// Real treasury visibility using what a Wise personal API token actually
// supports: reading profile + multi-currency balances. (Personal tokens
// do NOT support creating customer-facing payment links/requests --
// confirmed directly from Wise's own developer community, where someone
// hit this exact wall. Building a "create payment link" function against
// this token would have been guessing at an API that doesn't exist at
// this access tier -- the same mistake almost made with Stripe.)
//
// Payment links are still genuinely useful for the procurement page --
// just generate them once manually in the Wise app, then paste the
// resulting URL into the "Wise Account Details" field in Settings.

const WISE_API_BASE = "https://api.wise.com";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: setting } = await supabase
      .from("store_settings")
      .select("value")
      .eq("key", "wise_api_key")
      .maybeSingle();

    if (!setting?.value) {
      return new Response(JSON.stringify({ error: "wise_api_key not configured" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = { Authorization: `Bearer ${setting.value}` };

    const profilesRes = await fetch(`${WISE_API_BASE}/v2/profiles`, { headers: authHeader });
    if (!profilesRes.ok) {
      const err = await profilesRes.text();
      return new Response(JSON.stringify({ error: `Wise auth failed: ${err}` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const profiles = await profilesRes.json();
    // Business profile if one exists, otherwise the first (personal) profile.
    const profile = profiles.find((p: any) => p.type === "business") || profiles[0];

    if (!profile) {
      return new Response(JSON.stringify({ error: "No Wise profile found for this token" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const balancesRes = await fetch(`${WISE_API_BASE}/v4/profiles/${profile.id}/balances?types=STANDARD`, {
      headers: authHeader,
    });
    const balances = await balancesRes.json();

    const simplified = (Array.isArray(balances) ? balances : []).map((b: any) => ({
      currency: b.currency,
      amount: b.amount?.value ?? 0,
    }));

    return new Response(JSON.stringify({ profileId: profile.id, profileType: profile.type, balances: simplified }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
