// Admin-only rotation of the internal cron secret.
//
// Every pg_cron job reads the secret from the vault entry at call time, so
// updating that entry is all it takes for scheduled work to pick up the new
// value — no job command rewrites, no redeploys, no downtime. The previous
// value stays valid for a grace window (default 60 minutes) so any request
// already in flight, or an edge function still holding the old env value,
// keeps authenticating while the change propagates.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAuthContext, forbidden, unauthorized } from "../_shared/auth-guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await getAuthContext(req);
  if (!auth.userId) return unauthorized(corsHeaders);
  if (!auth.isAdmin) return forbidden(corsHeaders);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: { action?: string; grace_minutes?: number; note?: string } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const action = body.action ?? "rotate";

  if (action === "finalize") {
    const { data, error } = await admin.rpc("finalize_internal_cron_secret_rotation");
    if (error) return json({ error: error.message }, 500);
    return json({ status: "ok", retired: data ?? 0 });
  }

  if (action !== "rotate") return json({ error: "Unknown action" }, 400);

  const grace = Number(body.grace_minutes ?? 60);
  if (!Number.isFinite(grace) || grace < 5 || grace > 1440) {
    return json({ error: "grace_minutes must be between 5 and 1440" }, 400);
  }

  const { data, error } = await admin.rpc("rotate_internal_cron_secret", {
    p_grace_minutes: Math.round(grace),
    p_rotated_by: auth.userId,
    p_note: typeof body.note === "string" ? body.note.slice(0, 200) : null,
  });
  if (error) return json({ error: error.message }, 500);

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return json({ error: "Rotation returned no result" }, 500);

  // The plaintext is returned exactly once, so the admin can paste it into the
  // INTERNAL_CRON_SECRET function secret if they keep the env fallback in sync.
  // It is never written to logs or stored anywhere outside the vault.
  return json({
    status: "ok",
    new_secret: row.new_secret,
    fingerprint: row.fingerprint,
    grace_until: row.grace_until,
  });
});
