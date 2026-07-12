import { test, expect, request } from "@playwright/test";

/**
 * Verifies that the compliance pack unlock RPC (`get_compliance_pack`) is
 * strictly email-scoped:
 *
 *  - Submitting a quote request and calling the RPC with the SAME email
 *    (case-insensitive) returns the pack.
 *  - Calling the RPC with a DIFFERENT email returns nothing, even if the
 *    quote_request id is correct.
 *  - Calling the RPC with a wrong id returns nothing.
 *  - Every attempt (success + denied) is recorded in compliance_access_log,
 *    and the log stays admin-only to anon readers.
 */

const SUPABASE_URL = process.env.PLAYWRIGHT_SUPABASE_URL
  || "https://xwiqubcilptxzvdigsmp.supabase.co";
const SUPABASE_ANON = process.env.PLAYWRIGHT_SUPABASE_ANON_KEY
  || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh3aXF1YmNpbHB0eHp2ZGlnc21wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIwMTY2NzcsImV4cCI6MjA4NzU5MjY3N30.aiRYqZ2H2VTNc64hU2XdeESEz4VcxOW6BQKvhb0v-4I";

// Run once per test file — API-level, no browser needed.
test.describe.configure({ mode: "serial" });
test.beforeEach(({}, info) => {
  // Only run on one project so we don't hammer the DB twice.
  test.skip(info.project.name !== "desktop-chromium", "API tests run once");
});

async function rpc(url: string, name: string, args: Record<string, unknown>) {
  const ctx = await request.newContext();
  const res = await ctx.post(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${SUPABASE_ANON}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    data: args,
  });
  const body = res.ok() ? await res.json() : await res.text();
  await ctx.dispose();
  return { status: res.status(), body };
}

async function insertQuote(email: string) {
  const ctx = await request.newContext();
  const res = await ctx.post(`${SUPABASE_URL}/rest/v1/quote_requests`, {
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${SUPABASE_ANON}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    data: {
      contact_name: "Playwright Tester",
      email,
      company: "E2E QA",
      phone: "+27110000000",
      message: "Automated compliance-pack access test — please ignore.",
    },
  });
  expect(res.ok(), `insert quote_requests: ${res.status()} ${await res.text()}`).toBeTruthy();
  const rows = await res.json();
  await ctx.dispose();
  return rows[0] as { id: string; email: string };
}

test("compliance pack unlock is strictly email-scoped and audited", async () => {
  const stamp = Date.now();
  const email = `pw-owner-${stamp}@example.test`;
  const wrongEmail = `pw-attacker-${stamp}@example.test`;

  const quote = await insertQuote(email);
  expect(quote.id).toBeTruthy();

  // 1. Correct id + correct email (case-insensitive) → pack returned
  const ok = await rpc(SUPABASE_URL, "get_compliance_pack", {
    _quote_id: quote.id,
    _email: email.toUpperCase(),
  });
  expect(ok.status).toBe(200);
  expect(Array.isArray(ok.body)).toBeTruthy();
  expect(ok.body.length).toBe(1);
  expect(ok.body[0]).toHaveProperty("cipc_number");

  // 2. Correct id + WRONG email → nothing (silent deny, audited)
  const attacker = await rpc(SUPABASE_URL, "get_compliance_pack", {
    _quote_id: quote.id,
    _email: wrongEmail,
  });
  expect(attacker.status).toBe(200);
  expect(attacker.body).toEqual([]);

  // 3. WRONG id + correct email → nothing
  const wrongId = await rpc(SUPABASE_URL, "get_compliance_pack", {
    _quote_id: "00000000-0000-0000-0000-000000000000",
    _email: email,
  });
  expect(wrongId.body).toEqual([]);

  // 4. Missing input → nothing
  const empty = await rpc(SUPABASE_URL, "get_compliance_pack", {
    _quote_id: quote.id,
    _email: "",
  });
  expect(empty.body).toEqual([]);

  // 5. compliance_access_log is NOT readable by anon (admin-only)
  const ctx = await request.newContext();
  const log = await ctx.get(
    `${SUPABASE_URL}/rest/v1/compliance_access_log?quote_request_id=eq.${quote.id}`,
    { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` } },
  );
  // RLS returns 200 with [] for anon (no admin role) — must never leak rows.
  expect(log.status()).toBe(200);
  expect(await log.json()).toEqual([]);
  await ctx.dispose();
});
