import { test, expect, request, APIRequestContext } from "@playwright/test";

/**
 * Verifies the bank-grade `business_signups` trigger stack stays unbreakable:
 *   - honeypot submissions are rejected
 *   - free-webmail domains are rejected
 *   - duplicate submissions within 60s trip the rate-limit
 *   - anon cannot read submissions; admin can, and can flip status → approved
 *     (manual approval path). Admin-positive path skips without creds.
 */

const SUPABASE_URL = process.env.PLAYWRIGHT_SUPABASE_URL
  || "https://xwiqubcilptxzvdigsmp.supabase.co";
const SUPABASE_ANON = process.env.PLAYWRIGHT_SUPABASE_ANON_KEY
  || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh3aXF1YmNpbHB0eHp2ZGlnc21wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIwMTY2NzcsImV4cCI6MjA4NzU5MjY3N30.aiRYqZ2H2VTNc64hU2XdeESEz4VcxOW6BQKvhb0v-4I";

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "desktop-chromium", "API-level tests run once");
});

function uniqueEmail(domain = "unit-test.co.za") {
  return `qa+${Date.now()}-${Math.random().toString(36).slice(2, 7)}@${domain}`;
}

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    legal_entity_name: "QA Systems (Pty) Ltd",
    trading_name: "QA Systems",
    registration_number: "2024/000000/07",
    entity_type: "business",
    contact_full_name: "QA Bot",
    contact_position: "Buyer",
    work_email: uniqueEmail(),
    honeypot_flag: false,
    accept_terms: true,
    popia_consent: true,
    ...overrides,
  };
}

async function anonPost(ctx: APIRequestContext, table: string, data: unknown) {
  const res = await ctx.post(`${SUPABASE_URL}/rest/v1/${table}`, {
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${SUPABASE_ANON}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    data,
  });
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status(), body };
}

async function signInAdmin() {
  const email = process.env.PLAYWRIGHT_ADMIN_EMAIL;
  const password = process.env.PLAYWRIGHT_ADMIN_PASSWORD;
  if (!email || !password) return null;
  const ctx = await request.newContext();
  const res = await ctx.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: SUPABASE_ANON, "Content-Type": "application/json" },
    data: { email, password },
  });
  if (!res.ok()) { await ctx.dispose(); return null; }
  const { access_token } = await res.json();
  await ctx.dispose();
  return access_token as string;
}

test("honeypot submissions are rejected by the trigger", async () => {
  const ctx = await request.newContext();
  const { status, body } = await anonPost(ctx, "business_signups", basePayload({ honeypot_flag: true }));
  expect(status).toBeGreaterThanOrEqual(400);
  expect(JSON.stringify(body).toLowerCase()).toContain("rejected");
  await ctx.dispose();
});

test.describe("free-webmail domain rejection", () => {
  for (const domain of ["gmail.com", "yahoo.com", "outlook.com", "proton.me"]) {
    test(`rejects ${domain}`, async () => {
      const ctx = await request.newContext();
      const { status, body } = await anonPost(ctx, "business_signups", basePayload({ work_email: uniqueEmail(domain) }));
      expect(status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(body).toLowerCase()).toMatch(/business|institution|free webmail/);
      await ctx.dispose();
    });
  }
});

test("duplicate submissions from the same corporate email are rate-limited", async () => {
  const ctx = await request.newContext();
  const email = uniqueEmail("qa-rate-limit.co.za");
  const first = await anonPost(ctx, "business_signups", basePayload({ work_email: email }));
  // First insert may succeed (201) or fail if RLS blocks anon reads-after-insert;
  // either way the row is persisted. If it succeeded we expect a body id.
  expect([201, 200, 403]).toContain(first.status);

  const second = await anonPost(ctx, "business_signups", basePayload({ work_email: email }));
  expect(second.status).toBeGreaterThanOrEqual(400);
  expect(JSON.stringify(second.body).toLowerCase()).toContain("too many submissions");
  await ctx.dispose();
});

test("anon cannot read submissions and admin can flip status → approved", async () => {
  // 1. anon must not see any rows
  const anonCtx = await request.newContext();
  const anonRead = await anonCtx.get(`${SUPABASE_URL}/rest/v1/business_signups?select=*&limit=5`, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
  });
  if (anonRead.status() === 200) {
    expect(await anonRead.json()).toEqual([]);
  } else {
    expect([401, 403]).toContain(anonRead.status());
  }
  await anonCtx.dispose();

  const token = await signInAdmin();
  test.skip(!token, "PLAYWRIGHT_ADMIN_EMAIL/PASSWORD not set — skipping admin approval path");

  // 2. anon submits a fresh valid application
  const submitCtx = await request.newContext();
  const email = uniqueEmail("qa-approval.co.za");
  const submit = await anonPost(submitCtx, "business_signups", basePayload({ work_email: email }));
  expect([201, 403]).toContain(submit.status); // 201 with representation, or 403 hiding the row
  await submitCtx.dispose();

  // 3. admin reads it back and approves it
  const adminCtx = await request.newContext();
  const listRes = await adminCtx.get(
    `${SUPABASE_URL}/rest/v1/business_signups?select=id,status,work_email&work_email=eq.${encodeURIComponent(email)}`,
    { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${token}` } },
  );
  expect(listRes.status()).toBe(200);
  const rows = await listRes.json();
  expect(rows.length).toBe(1);
  const id = rows[0].id;

  const patchRes = await adminCtx.patch(
    `${SUPABASE_URL}/rest/v1/business_signups?id=eq.${id}`,
    {
      headers: {
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      data: { status: "approved", reviewed_at: new Date().toISOString() },
    },
  );
  expect(patchRes.status()).toBe(200);
  const updated = await patchRes.json();
  expect(updated[0].status).toBe("approved");
  await adminCtx.dispose();
});
