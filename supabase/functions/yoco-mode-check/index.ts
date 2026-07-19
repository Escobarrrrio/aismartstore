import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const k = Deno.env.get("YOCO_SECRET_KEY") ?? "";
  let mode: "live" | "test" | "unset" | "unknown" = "unknown";
  if (!k) mode = "unset";
  else if (/^sk_live_/i.test(k)) mode = "live";
  else if (/^sk_test_/i.test(k)) mode = "test";
  return new Response(JSON.stringify({ mode, configured: Boolean(k), prefix: k ? k.slice(0, 8) : null }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
