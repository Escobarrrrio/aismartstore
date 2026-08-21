// Abuse throttling for the scheduled sync endpoints.
//
// The secret gate is the real lock: a 256-bit key is not getting guessed. But
// "not guessable" and "not worth hammering" are different properties. Every
// rejected attempt still costs a JWT lookup or a hash comparison, and an
// attacker who fires thousands a minute makes us pay for their guessing. This
// caps that cost, and it does so BEFORE the secret is verified so the cheap
// path is the one an attacker hits.
//
// Built on the existing `rl_take` token bucket (20260730160000_engine_room_
// guardrails.sql) rather than a second mechanism: it is atomic under
// concurrency (the ON CONFLICT path takes a row lock, so a burst cannot race
// two requests past the same balance) and it already self-expires via
// rl_sweep, so it cannot be turned into a disk-fill vector.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// Per-IP: three attempts a minute. The legitimate callers are a 6-hourly cron
// job and the occasional admin "Run now" click, so this is orders of magnitude
// above real usage and still stops scripted guessing dead.
const PER_IP_CAPACITY = 3;
const PER_IP_REFILL_PER_MIN = 3;

// Per-endpoint ceiling. A botnet spreads across IPs and would sail through the
// per-IP bucket; this caps what the endpoint as a whole will even look at.
// Deliberately generous so one abusive source cannot starve the real cron run.
const GLOBAL_CAPACITY = 30;
const GLOBAL_REFILL_PER_MIN = 30;

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

/**
 * Caller identity for bucketing. The raw IP is hashed before it becomes a
 * bucket key: the key is effectively a log line, and storing visitor IPs in
 * plaintext for two days is a POPIA problem we do not need to have.
 */
export async function callerFingerprint(req: Request): Promise<string> {
  const fwd = req.headers.get("x-forwarded-for") ?? "";
  const ip =
    fwd.split(",")[0].trim() ||
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-real-ip") ||
    "unknown";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
  return Array.from(new Uint8Array(digest))
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export type ThrottleResult = { ok: true } | { ok: false; response: Response };

async function take(
  admin: SupabaseClient,
  key: string,
  capacity: number,
  refillPerMin: number,
): Promise<{ allowed: boolean; retryAfterS: number }> {
  try {
    const { data, error } = await admin.rpc("rl_take", {
      p_key: key,
      p_capacity: capacity,
      p_refill_per_min: refillPerMin,
      p_cost: 1,
    });
    // Fail open on infrastructure trouble. A throttle that takes the scheduled
    // catalogue sync offline when the database hiccups causes more damage than
    // the abuse it prevents — and gets ripped out within the week, leaving no
    // throttle at all.
    if (error) {
      console.error("[sync-throttle] rl_take failed, allowing", { key, error: error.message });
      return { allowed: true, retryAfterS: 0 };
    }
    const row = data as { allowed?: boolean; retry_after_s?: number } | null;
    if (row && row.allowed === false) {
      return { allowed: false, retryAfterS: Number(row.retry_after_s ?? 20) };
    }
    return { allowed: true, retryAfterS: 0 };
  } catch (e) {
    console.error("[sync-throttle] rl_take threw, allowing", { key, error: String(e) });
    return { allowed: true, retryAfterS: 0 };
  }
}

/**
 * Apply per-IP and per-endpoint throttling. Returns a ready-to-send 429 with a
 * truthful Retry-After when the caller is over budget — a 429 without one just
 * invites the same traffic a second later.
 */
export async function throttleSyncRequest(
  req: Request,
  endpoint: string,
  cors: Record<string, string>,
): Promise<ThrottleResult> {
  const admin = serviceClient();
  const fp = await callerFingerprint(req);

  const perIp = await take(admin, `sync:${endpoint}:ip:${fp}`, PER_IP_CAPACITY, PER_IP_REFILL_PER_MIN);
  const global = perIp.allowed
    ? await take(admin, `sync:${endpoint}:global`, GLOBAL_CAPACITY, GLOBAL_REFILL_PER_MIN)
    : { allowed: false, retryAfterS: perIp.retryAfterS };

  if (perIp.allowed && global.allowed) return { ok: true };

  const retryAfter = Math.max(1, Math.ceil(perIp.allowed ? global.retryAfterS : perIp.retryAfterS));
  // The response says nothing about whether the presented secret was close,
  // valid, or absent. A throttle that leaks "you were nearly right" is a
  // guessing oracle.
  return {
    ok: false,
    response: new Response(
      JSON.stringify({ error: "Too many requests. Please wait and try again.", retryAfterSecs: retryAfter }),
      {
        status: 429,
        headers: {
          ...cors,
          "Content-Type": "application/json",
          "Retry-After": String(retryAfter),
          "Access-Control-Expose-Headers": "retry-after",
        },
      },
    ),
  };
}
