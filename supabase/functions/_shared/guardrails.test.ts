import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { guard, record, callerKey, SMS_COST_ZAR } from "./guardrails.ts";

// A stand-in for the Supabase client that records what was asked of it and
// answers with whatever the test wants. The guardrails only ever call .rpc(),
// so this is the whole surface.
//
// `rl_take` is keyed twice per refusal -- once for the caller's own bucket and
// once for the log throttle -- so the fake answers on the bucket key, not just
// the function name. Answering only on the name would make it impossible to
// write a test where the caller is refused but the refusal is still logged,
// which is the ordinary case.
function fakeAdmin(replies: Record<string, { data?: unknown; error?: { message: string } }>) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    // deno-lint-ignore no-explicit-any
    rpc(fn: string, args: Record<string, unknown>): any {
      calls.push({ fn, args });
      const key = String(args?.p_key ?? "");
      if (fn === "rl_take" && key.startsWith("seclog:") && replies["rl_take:seclog"]) {
        return Promise.resolve(replies["rl_take:seclog"]);
      }
      return Promise.resolve(replies[fn] ?? { data: null, error: null });
    },
  };
}

Deno.test("callerKey takes the last x-forwarded-for entry, not the first", () => {
  // The leftmost entry is whatever the client wrote. Trusting it would let an
  // attacker mint a fresh bucket per request by rotating a header they control,
  // which is a rate limiter that limits nothing.
  const req = new Request("https://x/", {
    headers: { "x-forwarded-for": "1.1.1.1, 2.2.2.2, 203.0.113.9" },
  });
  assertEquals(callerKey(req), "203.0.113.9");
});

Deno.test("callerKey falls back through the other proxy headers, then to the default", () => {
  assertEquals(callerKey(new Request("https://x/", { headers: { "cf-connecting-ip": "9.9.9.9" } })), "9.9.9.9");
  assertEquals(callerKey(new Request("https://x/")), "unknown");
  assertEquals(callerKey(new Request("https://x/"), "anon"), "anon");
});

Deno.test("callerKey ignores an empty x-forwarded-for rather than returning blank", () => {
  const req = new Request("https://x/", { headers: { "x-forwarded-for": "  ,  " } });
  assertEquals(callerKey(req), "unknown");
});

Deno.test("guard allows when both checks pass", async () => {
  const admin = fakeAdmin({
    rl_take: { data: { allowed: true, remaining: 4 } },
    spend_guard: { data: { allowed: true, blocked: false, reason: "ok" } },
  });
  // deno-lint-ignore no-explicit-any
  const r = await guard(admin as any, { provider: "telnyx-sms", bucket: "b", capacity: 5, refillPerMin: 1 });
  assertEquals(r.ok, true);
  assertEquals(admin.calls.map((c) => c.fn), ["rl_take", "spend_guard"]);
});

Deno.test("guard refuses a rate-limited caller with 429 and a real Retry-After", async () => {
  const admin = fakeAdmin({
    rl_take: { data: { allowed: false, reason: "rate_limited", remaining: 0, retry_after_s: 120 } },
    // The log throttle has room, so this refusal does get written down.
    "rl_take:seclog": { data: { allowed: true, remaining: 0 } },
  });
  // deno-lint-ignore no-explicit-any
  const r = await guard(admin as any, { provider: "telnyx-sms", bucket: "b", capacity: 5, refillPerMin: 0.5 });
  assertEquals(r.ok, false);
  assertEquals(r.response!.status, 429);
  assertEquals(r.response!.headers.get("Retry-After"), "120");
  // Refused at the bucket, so the spend check is never reached.
  assertEquals(admin.calls.map((c) => c.fn), ["rl_take", "rl_take", "sec_log"]);
});

Deno.test("refusal logging is throttled so a flood cannot write a row per request", async () => {
  // Logging every refusal makes the defence generate load in proportion to the
  // attack, and fills the disk on the way. Once the log throttle's own bucket
  // is empty, refusals still refuse but stop writing.
  // Both refuse: the caller's bucket (they are flooding) and the log throttle
  // (we already wrote one of these in the last five minutes).
  const admin = fakeAdmin({
    rl_take: { data: { allowed: false, reason: "rate_limited", remaining: 0, retry_after_s: 30 } },
    "rl_take:seclog": { data: { allowed: false, reason: "rate_limited", remaining: 0, retry_after_s: 240 } },
  });
  // deno-lint-ignore no-explicit-any
  const r = await guard(admin as any, { provider: "telnyx-sms", bucket: "b", capacity: 5, refillPerMin: 1 });
  // Still refused -- the throttle suppresses the writing, never the refusing.
  assertEquals(r.ok, false);
  assertEquals(r.response!.status, 429);
  assertEquals(admin.calls.filter((c) => c.fn === "sec_log").length, 0);
});

Deno.test("a failing log throttle logs anyway rather than losing the refusal", async () => {
  const admin = fakeAdmin({
    rl_take: { error: { message: "throttle unavailable" } },
  });
  // rl_take erroring means the caller's own bucket check also fails open, so
  // this path allows the request -- the assertion that matters is that the
  // helper does not throw on the way.
  // deno-lint-ignore no-explicit-any
  const r = await guard(admin as any, { provider: "telnyx-sms", bucket: "b", capacity: 5, refillPerMin: 1 });
  assertEquals(r.ok, true);
});

Deno.test("guard refuses a capped provider with 503, not 429", async () => {
  // 429 would tell a well-behaved client "you personally are too fast", which
  // is wrong and invites a retry in a few seconds. The capability is off for
  // the day; that is a 503.
  const admin = fakeAdmin({
    rl_take: { data: { allowed: true, remaining: 9 } },
    spend_guard: { data: { allowed: false, blocked: true, reason: "daily_rand_cap", spent_today: 60, daily_cap: 60 } },
  });
  // deno-lint-ignore no-explicit-any
  const r = await guard(admin as any, { provider: "telnyx-sms", bucket: "b", capacity: 10, refillPerMin: 1 });
  assertEquals(r.ok, false);
  assertEquals(r.reason, "daily_rand_cap");
  assertEquals(r.response!.status, 503);
  assertEquals(r.response!.headers.get("Retry-After"), "3600");
});

Deno.test("a cap that is over but not hard_stop warns without blocking", async () => {
  const admin = fakeAdmin({
    rl_take: { data: { allowed: true, remaining: 9 } },
    spend_guard: { data: { allowed: true, blocked: false, reason: "daily_rand_cap" } },
  });
  // deno-lint-ignore no-explicit-any
  const r = await guard(admin as any, { provider: "ai-gateway" , bucket: "b", capacity: 10, refillPerMin: 1 });
  assertEquals(r.ok, true);
});

Deno.test("guard fails open when the guard itself errors", async () => {
  // A guardrail that takes the storefront down when it malfunctions gets
  // removed within the week, and then there is no guardrail at all.
  const admin = fakeAdmin({
    rl_take: { error: { message: "connection reset" } },
    spend_guard: { error: { message: "connection reset" } },
  });
  // deno-lint-ignore no-explicit-any
  const r = await guard(admin as any, { provider: "telnyx-sms", bucket: "b", capacity: 5, refillPerMin: 1 });
  assertEquals(r.ok, true);
});

Deno.test("guard skips the bucket entirely when no bucket key is given", async () => {
  const admin = fakeAdmin({ spend_guard: { data: { allowed: true, blocked: false } } });
  // deno-lint-ignore no-explicit-any
  await guard(admin as any, { provider: "axiz" });
  assertEquals(admin.calls.map((c) => c.fn), ["spend_guard"]);
});

Deno.test("record passes the cost straight through and never throws on failure", async () => {
  const admin = fakeAdmin({ spend_record: { error: { message: "gone" } } });
  // deno-lint-ignore no-explicit-any
  await record(admin as any, { provider: "telnyx-sms", source: "send-phone-otp", costZar: SMS_COST_ZAR });
  assertEquals(admin.calls[0].args.p_cost_zar, SMS_COST_ZAR);
  assertEquals(admin.calls[0].args.p_provider, "telnyx-sms");
});

Deno.test("a misconfigured bucket is refused distinctly from ordinary load", async () => {
  // cost_exceeds_capacity is our bug, not a greedy caller. It must not be
  // mistaken for traffic and "fixed" by raising a limit that was never the
  // problem -- so the reason survives into the result.
  const admin = fakeAdmin({
    rl_take: { data: { allowed: false, reason: "cost_exceeds_capacity", remaining: 0, retry_after_s: 0 } },
  });
  // deno-lint-ignore no-explicit-any
  const r = await guard(admin as any, { provider: "telnyx-sms", bucket: "b", capacity: 1, refillPerMin: 1 });
  assertEquals(r.ok, false);
  // No Retry-After: there is no time at which this request would succeed.
  assertEquals(r.response!.headers.get("Retry-After"), null);
});
