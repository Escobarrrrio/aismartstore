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

for (const fn of ENDPOINTS) {
  test(`${fn} rejects an unauthenticated caller with 403`, async () => {
    const { status } = await post(fn, {});
    expect(status, `${fn} must not run for anonymous callers`).toBe(403);
  });

  test(`${fn} rejects a wrong internal secret with 403`, async () => {
    const { status } = await post(fn, { "x-internal-secret": "not-the-real-secret-0000" });
    expect(status).toBe(403);
  });

  test(`${fn} rejects an empty internal secret with 403`, async () => {
    const { status } = await post(fn, { "x-internal-secret": "" });
    expect(status).toBe(403);
  });

  test(`${fn} rejects a non-admin (anon) JWT with 403`, async () => {
    const { status } = await post(fn, {
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${SUPABASE_ANON}`,
    });
    expect(status).toBe(403);
  });

  test(`${fn} accepts the intended internal cron secret`, async () => {
    test.skip(!CRON_SECRET, "PLAYWRIGHT_INTERNAL_CRON_SECRET not provided");
    const { status } = await post(fn, { "x-internal-secret": CRON_SECRET });
    expect(status, `${fn} must run for the cron path`).toBeLessThan(400);
  });
}
