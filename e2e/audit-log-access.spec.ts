import { test, expect, request } from "@playwright/test";

/**
 * Verifies that the audit log tables (`compliance_access_log`, `order_audit_log`)
 * are strictly admin-only readable. Anonymous / non-admin API traffic MUST
 * receive an empty result set (or a 4xx) — never a real row.
 *
 * We also assert that non-admin traffic cannot write to either table (the
 * only legitimate writers are our SECURITY DEFINER RPCs / triggers).
 *
 * Admin-positive coverage runs when PLAYWRIGHT_ADMIN_EMAIL /
 * PLAYWRIGHT_ADMIN_PASSWORD are provided in the environment; otherwise it
 * is skipped so CI stays green in projects without an admin fixture.
 */

const SUPABASE_URL = process.env.PLAYWRIGHT_SUPABASE_URL
  || "https://xwiqubcilptxzvdigsmp.supabase.co";
const SUPABASE_ANON = process.env.PLAYWRIGHT_SUPABASE_ANON_KEY
  || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh3aXF1YmNpbHB0eHp2ZGlnc21wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIwMTY2NzcsImV4cCI6MjA4NzU5MjY3N30.aiRYqZ2H2VTNc64hU2XdeESEz4VcxOW6BQKvhb0v-4I";

const AUDIT_TABLES = ["compliance_access_log", "order_audit_log"] as const;

test.describe.configure({ mode: "serial" });
test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "desktop-chromium", "API tests run once");
});

async function anonGet(path: string) {
  const ctx = await request.newContext();
  const res = await ctx.get(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
  });
  const status = res.status();
  const body = res.headers()["content-type"]?.includes("application/json")
    ? await res.json().catch(() => null)
    : await res.text();
  await ctx.dispose();
  return { status, body };
}

async function anonPost(path: string, data: unknown) {
  const ctx = await request.newContext();
  const res = await ctx.post(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${SUPABASE_ANON}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    data,
  });
  const status = res.status();
  const body = await res.text();
  await ctx.dispose();
  return { status, body };
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
  if (!res.ok()) {
    await ctx.dispose();
    return null;
  }
  const json = await res.json();
  await ctx.dispose();
  return json.access_token as string;
}

for (const table of AUDIT_TABLES) {
  test(`anon cannot read ${table}`, async () => {
    const { status, body } = await anonGet(`${table}?select=*&limit=5`);
    // Either RLS filters everything out (200 + []) or PostgREST rejects (401/403).
    // Anything with rows would be a leak.
    if (status === 200) {
      expect(Array.isArray(body)).toBeTruthy();
      expect((body as unknown[]).length).toBe(0);
    } else {
      expect([401, 403, 404]).toContain(status);
    }
  });

  test(`anon cannot write to ${table}`, async () => {
    const payload = table === "compliance_access_log"
      ? { event_type: "pack_unlock_success", email: "attacker@example.test" }
      : { order_id: "00000000-0000-0000-0000-000000000000", event_type: "status_changed", to_value: "shipped" };
    const { status } = await anonPost(table, payload);
    expect([401, 403, 404, 409, 400, 500, 42501 as unknown as number]).toContain(status);
    expect(status).not.toBe(201);
    expect(status).not.toBe(200);
  });
}

test("admin can read audit logs (skipped without admin creds)", async () => {
  const token = await signInAdmin();
  test.skip(!token, "PLAYWRIGHT_ADMIN_EMAIL/PASSWORD not set — skipping admin positive path");

  for (const table of AUDIT_TABLES) {
    const ctx = await request.newContext();
    const res = await ctx.get(`${SUPABASE_URL}/rest/v1/${table}?select=*&limit=1`, {
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${token}` },
    });
    expect(res.status(), `admin GET ${table}`).toBe(200);
    const rows = await res.json();
    expect(Array.isArray(rows)).toBeTruthy();
    await ctx.dispose();
  }
});
