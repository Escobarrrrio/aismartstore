import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2/cors";
import { getAuthContext } from "../_shared/auth-guard.ts";

// Treasury visibility - admin only. Returns Wise multi-currency balances.

const WISE_API_BASE = "https://api.wise.com";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // SECURITY: admin JWT required — this exposes live company balances.
    const auth = await getAuthContext(req);
    if (!auth.userId || !auth.isAdmin) {
      return new Response(JSON.stringify({ error: "Admin role required" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = { Authorization: `Bearer ${setting.value}` };

    const profilesRes = await fetch(`${WISE_API_BASE}/v2/profiles`, { headers: authHeader });
    if (!profilesRes.ok) {
      return new Response(JSON.stringify({ error: "Wise auth failed" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const profiles = await profilesRes.json();
    const profile = profiles.find((p: any) => p.type === "business") || profiles[0];
    if (!profile) {
      return new Response(JSON.stringify({ error: "No Wise profile found" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
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
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
