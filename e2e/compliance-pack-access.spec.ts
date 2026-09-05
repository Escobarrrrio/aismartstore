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
 *
 * This file previously never actually exercised any of that: it pointed at
 * okejdzkftwhccplyfluf.supabase.co, a project this store stopped running on
 * during a prior platform migration, and posted `company`/`message` fields
 * to quote_requests -- columns that don't exist (the real ones are
 * `organisation_name`/`requirements`). Both were silent because
 * E2E_SUPABASE_URL/E2E_SUPABASE_SERVICE_ROLE_KEY have never been set as CI
 * secrets, so this spec has been skipped on every run rather than failing
 * loudly. Fixed alongside the same investigation that found and fixed the
 * live form's real bugs (entity_type mismatch, missing SELECT-after-insert
 * RLS -- see 20260812161500/20260812162000).
 */

const SUPABASE_URL = process.env.PLAYWRIGHT_SUPABASE_URL
  || "https://okejdzkftwhccplyfluf.supabase.co";
const SUPABASE_ANON = process.env.PLAYWRIGHT_SUPABASE_ANON_KEY
  || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9rZWpkemtmdHdoY2NwbHlmbHVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5NDU0MjAsImV4cCI6MjEwMTUyMTQyMH0.JHSxZe_hSQtAH7nABmlRQlV2QlNJDYmOYbkcGnpKbj4";

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

// Goes through submit_quote_request, the same RPC the live form calls --
// not a raw POST to /rest/v1/quote_requests. quote_requests has no SELECT
// policy for anon (only admins), and Postgres requires an INSERT ...
// RETURNING row to satisfy a SELECT policy or it raises an error; a raw
// REST insert with Prefer: return=representation would hit exactly that
// wall regardless of which columns it sent.
async function submitQuote(email: string) {
  const res = await rpc(SUPABASE_URL, "submit_quote_request", {
    p_organisation_name: "E2E QA",
    p_entity_type: "private",
    p_contact_name: "Playwright Tester",
    p_email: email,
    p_phone: "+27110000000",
    p_requirements: "Automated compliance-pack access test — please ignore.",
    p_estimated_value: null,
  });
  expect(res.status, `submit_quote_request: ${res.status} ${JSON.stringify(res.body)}`).toBe(200);
  expect(Array.isArray(res.body) && res.body.length === 1, "expected exactly one row back (not quarantined)").toBeTruthy();
  return res.body[0] as { id: string; email: string };
}

test("compliance pack unlock is strictly email-scoped and audited", async () => {
  const stamp = Date.now();
  const email = `pw-owner-${stamp}@example.test`;
  const wrongEmail = `pw-attacker-${stamp}@example.test`;

  const quote = await submitQuote(email);
  expect(quote.id).toBeTruthy();

  // 1. Correct id + correct email (case-insensitive) → pack returned
  const ok = await rpc(SUPABASE_URL, "get_compliance_pack", {
    _quote_id: quote.id,
    _email: email.toUpperCase(),
  });
  expect(ok.status).toBe(200);
  expect(Array.isArray(ok.body)).toBeTruthy();
  expect(ok.body.length).toBe(1);
  expect(ok.body[0]).toHaveProperty("cipc_registration_number");

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
