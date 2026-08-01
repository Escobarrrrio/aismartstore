// Client side of the Engine Room guardrails (20260730160000_engine_room_guardrails.sql).
//
// Three calls, in this order, around anything that costs money:
//
//   const gate = await guard(admin, { provider, bucket, capacity, refillPerMin, estimatedCostZar })
//   if (!gate.ok) return gate.response          // 429, with a truthful Retry-After
//   ... make the expensive call ...
//   await record(admin, { provider, source, costZar })
//
// WHY THE ORDER MATTERS
// ---------------------
// The rate limit is taken *before* the spend check, and both before the call.
// Reversed, a burst gets its spend counted only after the money is gone, which
// is what every "we noticed the bill on Monday" story has in common.
//
// WHY FAILURES HERE ARE FAIL-OPEN, EXCEPT ONE
// -------------------------------------------
// If the guard RPC itself errors -- database blip, migration mid-flight -- the
// call is allowed and the incident is logged. A guardrail that takes the
// storefront down when it malfunctions gets removed within the week, and then
// there is no guardrail at all.
//
// The exception is an explicit `blocked: true` from spend_guard(). That is not
// a malfunction, it is the system working, and it is honoured absolutely --
// including for admin-triggered calls. There is no bypass parameter in this
// module, deliberately: a bypass is the first thing a stolen admin session
// reaches for.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2/cors";

export interface GuardOptions {
  /** Must match a row in spend_caps, or spending is unmetered. */
  provider: string;
  /** Bucket identity, e.g. `otp:${userId}`. Omit to skip rate limiting. */
  bucket?: string;
  /** Burst allowance: how many requests back-to-back before refusing. */
  capacity?: number;
  /** Sustained allowance, in requests per minute. */
  refillPerMin?: number;
  /** What this one call is expected to cost, in rand. Used for the pre-check. */
  estimatedCostZar?: number;
  /** Free-text label recorded on refusals so the Engine Room can attribute them. */
  source?: string;
}

export interface GuardResult {
  ok: boolean;
  /** Present only when ok is false -- return it directly. */
  response?: Response;
  reason?: string;
}

function refusal(body: Record<string, unknown>, status: number, retryAfterS?: number) {
  const headers: Record<string, string> = {
    ...corsHeaders,
    "Content-Type": "application/json",
    // A guardrail refusal is the error a confused customer is most likely to
    // report, and these responses bypass the calling function's own CORS
    // headers entirely. Without naming the header here the browser hides it,
    // so the reference the UI tries to show would be blank on exactly the
    // refusals we most want to trace.
    "Access-Control-Expose-Headers": "x-request-id, sb-request-id",
    "x-request-id": crypto.randomUUID().slice(0, 8),
  };
  // A 429 without Retry-After invites an immediate retry, which is the same
  // traffic again one second later. The number comes from the token bucket's
  // actual refill rate, so it is a real answer rather than a polite guess.
  if (retryAfterS && retryAfterS > 0) headers["Retry-After"] = String(Math.ceil(retryAfterS));
  return new Response(JSON.stringify(body), { status, headers });
}

export async function guard(
  admin: SupabaseClient,
  opts: GuardOptions,
): Promise<GuardResult> {
  const source = opts.source ?? opts.provider;

  if (opts.bucket) {
    try {
      const { data, error } = await admin.rpc("rl_take", {
        p_key: opts.bucket,
        p_capacity: opts.capacity ?? 10,
        p_refill_per_min: opts.refillPerMin ?? 1,
        p_cost: 1,
      });
      if (error) {
        console.error("[guardrails] rl_take failed, allowing", { error: error.message, bucket: opts.bucket });
      } else if (data && data.allowed === false) {
        // cost_exceeds_capacity is a coding error on our side, not a caller
        // being greedy. Logged distinctly so it does not get "fixed" by
        // raising a limit that was never the problem.
        if (data.reason === "cost_exceeds_capacity") {
          console.error("[guardrails] bucket misconfigured", { bucket: opts.bucket, capacity: opts.capacity });
        }
        // Throttled through the same bucket mechanism, at most one row per
        // source per five minutes.
        //
        // Logging every refusal was the obvious thing and was wrong: under an
        // actual flood it writes one audit row per attacking request, so the
        // defence generates load in direct proportion to the attack and fills
        // the disk on the way. A rate limiter that cannot be triggered cheaply
        // is not a rate limiter.
        //
        // Sampling loses nothing that matters here. The question this log
        // answers is "is something pushing at us", which one row every five
        // minutes answers exactly as well as ten thousand -- and the ten
        // thousandth row is the one that makes the table unreadable.
        await secThrottled(admin, source, "rate_limited", "low", { bucket: opts.bucket, ...data });
        return {
          ok: false,
          reason: "rate_limited",
          response: refusal(
            { error: "Too many requests. Please wait a moment and try again.", retryAfterSecs: data.retry_after_s },
            429,
            data.retry_after_s,
          ),
        };
      }
    } catch (e) {
      console.error("[guardrails] rl_take threw, allowing", { error: String(e) });
    }
  }

  try {
    const { data, error } = await admin.rpc("spend_guard", {
      p_provider: opts.provider,
      p_estimated_cost_zar: opts.estimatedCostZar ?? 0,
    });
    if (error) {
      console.error("[guardrails] spend_guard failed, allowing", { error: error.message, provider: opts.provider });
      return { ok: true };
    }
    if (data && data.blocked === true) {
      console.error("[guardrails] SPEND CAP REACHED", { provider: opts.provider, reason: data.reason,
        spentToday: data.spent_today, dailyCap: data.daily_cap });
      // 503, not 429: this is not "you specifically are going too fast", it is
      // "this capability is switched off for now". Retry-After of an hour keeps
      // well-behaved clients from hammering a door that will not open today.
      return {
        ok: false,
        reason: data.reason,
        response: refusal(
          { error: "This service has reached its daily limit and will resume tomorrow." },
          503,
          3600,
        ),
      };
    }
  } catch (e) {
    console.error("[guardrails] spend_guard threw, allowing", { error: String(e) });
  }

  return { ok: true };
}

export async function record(
  admin: SupabaseClient,
  opts: { provider: string; source: string; units?: number; costZar?: number; meta?: Record<string, unknown> },
): Promise<void> {
  try {
    const { error } = await admin.rpc("spend_record", {
      p_provider: opts.provider,
      p_source: opts.source,
      p_units: opts.units ?? 1,
      p_cost_zar: opts.costZar ?? 0,
      p_meta: opts.meta ?? {},
    });
    // A missed ledger row understates spend, so the next guard() lets through
    // slightly more than it should. Worth a loud log; not worth failing a call
    // the customer has already been served.
    if (error) console.error("[guardrails] spend_record failed", { error: error.message, provider: opts.provider });
  } catch (e) {
    console.error("[guardrails] spend_record threw", { error: String(e) });
  }
}

/**
 * sec(), but at most once per `source` per five minutes.
 *
 * Uses rl_take against a bucket in its own namespace, so the throttle shares
 * the limiter's atomicity: concurrent refusals cannot all decide they are the
 * one allowed to log. Capacity 1 with a 0.2/min refill is exactly "one, then
 * one every five minutes".
 */
async function secThrottled(
  admin: SupabaseClient,
  source: string,
  kind: string,
  severity: "info" | "low" | "medium" | "high" | "critical",
  detail: Record<string, unknown>,
): Promise<void> {
  try {
    const { data, error } = await admin.rpc("rl_take", {
      p_key: `seclog:${kind}:${source}`,
      p_capacity: 1,
      p_refill_per_min: 0.2,
      p_cost: 1,
    });
    // If the throttle check itself fails we log anyway. Losing visibility of a
    // refusal is worse than one extra row.
    if (error || !data || data.allowed !== false) {
      await sec(admin, kind, severity, source, detail);
    }
  } catch {
    await sec(admin, kind, severity, source, detail);
  }
}

export async function sec(
  admin: SupabaseClient,
  kind: string,
  severity: "info" | "low" | "medium" | "high" | "critical",
  actor: string | null,
  detail: Record<string, unknown> = {},
): Promise<void> {
  try {
    await admin.rpc("sec_log", { p_kind: kind, p_severity: severity, p_actor: actor, p_detail: detail });
  } catch (e) {
    console.error("[guardrails] sec_log threw", { error: String(e) });
  }
}

/**
 * Best-effort caller identity for bucketing.
 *
 * Behind Supabase's edge proxy the client address is only in the forwarded
 * headers, and the leftmost entry of x-forwarded-for is the one the client
 * itself can set to anything. We take the *last* entry instead: that one was
 * written by the proxy nearest us and is the hardest for a caller to forge.
 *
 * This is deliberately not a security boundary -- it buckets, it does not
 * authenticate. Anything that must not be shared across users buckets on a
 * user id, not on this.
 */
export function callerKey(req: Request, fallback = "unknown"): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip") ?? fallback;
}

/** Telnyx SMS to a South African number, in rand. */
export const SMS_COST_ZAR = 0.25;
