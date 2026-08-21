import { test, expect, request } from "@playwright/test";

/**
 * The scheduled sync endpoints are the most attractive unauthenticated targets
 * in the project: one of them hammers a dozen third-party feeds, the other
 * burns a free FX provider's quota. Both were briefly reachable by anyone.
 *
 * These tests lock the gate shut:
 *   - no credentials            -> 403
 *   - wrong / empty secret      -> 403
 *   - an anon JWT (non-admin)   -> 403
 *   - the intended cron secret  -> 2xx (only when the secret is supplied to CI)
 */

const SUPABASE_URL =
  process.env.PLAYWRIGHT_SUPABASE_URL || "https://xwiqubcilptxzvdigsmp.supabase.co";
const SUPABASE_ANON =
  process.env.PLAYWRIGHT_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh3aXF1YmNpbHB0eHp2ZGlnc21wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIwMTY2NzcsImV4cCI6MjA4NzU5MjY3N30.aiRYqZ2H2VTNc64hU2XdeESEz4VcxOW6BQKvhb0v-4I";
const CRON_SECRET = process.env.PLAYWRIGHT_INTERNAL_CRON_SECRET || "";

const ENDPOINTS = ["sync-ai-pulse", "sync-exchange-rates"] as const;

// Serial, not parallel: these tests share one rate-limit bucket per endpoint.
// Run concurrently they would throttle each other and the results would say
// more about scheduling order than about the endpoints.
test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "desktop-chromium", "API-level tests run once");
});

async function post(fn: string, headers: Record<string, string>) {
  const ctx = await request.newContext();
  const res = await ctx.post(`${SUPABASE_URL}/functions/v1/${fn}`, {
    headers: { "Content-Type": "application/json", ...headers },
    data: {},
    timeout: 60_000,
  });
  const status = res.status();
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = await res.text();
  }
  await ctx.dispose();
  return { status, body };
}

// Every rejection below is asserted as "403 or 429", never as a bare 403.
// These endpoints are throttled to 3 attempts/minute per IP, so the fourth
// probe this file sends legitimately comes back 429 — and a suite that
// insisted on 403 would fail precisely because the defence it is testing is
// working. Both codes mean the same thing for our purposes: the request did
// not run. 2xx is the only outcome that would be a real failure.
const DENIED = [403, 429];

for (const fn of ENDPOINTS) {
  test(`${fn} rejects an unauthenticated caller`, async () => {
    const { status } = await post(fn, {});
    expect(DENIED, `${fn} must not run for anonymous callers`).toContain(status);
  });

  test(`${fn} rejects a wrong internal secret`, async () => {
    const { status } = await post(fn, { "x-internal-secret": "not-the-real-secret-0000" });
    expect(DENIED).toContain(status);
  });

  test(`${fn} rejects an empty internal secret`, async () => {
    const { status } = await post(fn, { "x-internal-secret": "" });
    expect(DENIED).toContain(status);
  });

  test(`${fn} rejects a non-admin (anon) JWT`, async () => {
    const { status } = await post(fn, {
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${SUPABASE_ANON}`,
    });
    expect(DENIED).toContain(status);
  });

  test(`${fn} throttles repeated secret-guessing with a 429 and Retry-After`, async () => {
    // Six rapid guesses against a 3-per-minute bucket. The point is not that a
    // wrong secret is refused (already covered) but that an attacker cannot
    // make us evaluate thousands of guesses a minute.
    const results: number[] = [];
    let retryAfter: string | null = null;
    const ctx = await request.newContext();
    for (let i = 0; i < 6; i++) {
      const res = await ctx.post(`${SUPABASE_URL}/functions/v1/${fn}`, {
        headers: { "Content-Type": "application/json", "x-internal-secret": `guess-${i}` },
        data: {},
        timeout: 60_000,
      });
      results.push(res.status());
      retryAfter = retryAfter ?? res.headers()["retry-after"] ?? null;
    }
    await ctx.dispose();

    expect(results.filter((s) => s === 429).length, `expected throttling, got ${results.join(",")}`)
      .toBeGreaterThan(0);
    expect(results.some((s) => s < 400), "no guess may ever succeed").toBe(false);
    // A 429 without Retry-After just invites the same traffic a second later.
    expect(Number(retryAfter)).toBeGreaterThan(0);
  });

  test(`${fn} accepts the intended internal cron secret`, async () => {
    test.skip(!CRON_SECRET, "PLAYWRIGHT_INTERNAL_CRON_SECRET not provided");
    // Wait out the bucket filled by the throttling test above so this asserts
    // the auth path, not the rate limiter.
    await new Promise((r) => setTimeout(r, 70_000));
    const { status } = await post(fn, { "x-internal-secret": CRON_SECRET });
    expect(status, `${fn} must run for the cron path`).toBeLessThan(400);
  });
}

