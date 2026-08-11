import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Keys whose full value should NEVER be sent back to the browser.
// Anything not listed here is considered non-sensitive and is returned in full.
const SENSITIVE_KEYS = new Set<string>([
  "yoco_secret_key",
  "stripe_secret_key",
  "stripe_webhook_secret",
  "paypal_client_secret",
  "resend_api_key",
  "axiz_api_key",
  "telnyx_api_key",
  "courier_guy_api_key",
  "make_webhook_url",
  "wise_account_details",
  "serpapi_key",
  "tavily_api_key",
]);

function maskValue(v: string): string {
  const tail = v.length >= 4 ? v.slice(-4) : "";
  return `__MASKED__:${tail}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify caller identity with anon client bound to their JWT.
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Admin check via user_roles (RLS-safe: uses service role for lookup).
    const admin = createClient(supabaseUrl, serviceKey);
    const { data: roleRow } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (!roleRow) {
      return new Response(JSON.stringify({ error: "Admin role required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: rows, error } = await admin
      .from("store_settings")
      .select("key, value");
    if (error) throw error;

    const settings: Record<string, string> = {};
    const previews: Record<string, string> = {};
    const configured: string[] = [];

    for (const r of rows ?? []) {
      const key = r.key as string;
      const val = (r.value as string | null) ?? "";
      if (SENSITIVE_KEYS.has(key)) {
        if (val) {
          settings[key] = maskValue(val);
          previews[key] = "••••" + (val.length >= 4 ? val.slice(-4) : "");
          configured.push(key);
        } else {
          settings[key] = "";
        }
      } else {
        settings[key] = val;
        if (val) configured.push(key);
      }
    }

    return new Response(
      JSON.stringify({ settings, previews, configured }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("admin-get-settings error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
