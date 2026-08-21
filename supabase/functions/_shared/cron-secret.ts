// Shared gate for scheduled ("internal") edge function calls.
//
// Historically each sync function compared the incoming `x-internal-secret`
// header against the INTERNAL_CRON_SECRET env var only. That made rotation a
// downtime event: the moment the vault value changed, every cron call started
// failing until the function secret was updated and all functions redeployed.
//
// The database now tracks secret *versions* (hashes only, never plaintext) and
// keeps the previous value valid for a grace window, so this helper accepts:
//   1. the env var value (belt-and-braces / local dev),
//   2. a service-role bearer token,
//   3. any secret version the database still considers valid.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

let cached: SupabaseClient | null = null;

function serviceClient(): SupabaseClient {
  if (!cached) {
    cached = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
  }
  return cached;
}

/** Constant-time-ish comparison so a wrong secret can't be probed byte by byte. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function isInternalCaller(req: Request): Promise<boolean> {
  const provided = req.headers.get("x-internal-secret") ?? "";
  const envSecret = Deno.env.get("INTERNAL_CRON_SECRET") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authHeader = req.headers.get("Authorization") ?? "";

  if (envSecret.length > 0 && safeEqual(provided, envSecret)) return true;
  if (serviceRoleKey.length > 0 && safeEqual(authHeader, `Bearer ${serviceRoleKey}`)) return true;
  if (provided.length === 0) return false;

  try {
    const { data, error } = await serviceClient().rpc("verify_internal_cron_secret", {
      p_secret: provided,
    });
    if (error) return false;
    return data === true;
  } catch {
    return false;
  }
}
