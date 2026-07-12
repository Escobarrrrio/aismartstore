import { test, expect, request } from "@playwright/test";

/**
 * Attempts to bypass RLS on `compliance_access_log` and `order_audit_log`
 * with crafted PostgREST filters (OR chains, `not.is.null`, id enumeration,
 * `select=*`). All anon attempts must return an empty array or a 4xx.
 *
 * Admins retain full access (skipped without admin creds).
 */

const SUPABASE_URL = process.env.PLAYWRIGHT_SUPABASE_URL
  || "https://xwiqubcilptxzvdigsmp.supabase.co";
const SUPABASE_ANON = process.env.PLAYWRIGHT_SUPABASE_ANON_KEY
  || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh3aXF1YmNpbHB0eHp2ZGlnc21wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIwMTY2NzcsImV4cCI6MjA4NzU5MjY3N30.aiRYqZ2H2VTNc64hU2XdeESEz4VcxOW6BQKvhb0v-4I";

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "desktop-chromium", "API-level tests run once");
});

const TABLES = ["compliance_access_log", "order_audit_log"] as const;

const CRAFTED_QUERIES = [
  "select=*",
  "select=*&limit=1000",
  "select=*&id=not.is.null",
  "select=*&or=(id.not.is.null,event_type.not.is.null)",
  "select=id,event_type&order=created_at.desc",
  "select=*&created_at=gte.1970-01-01",
  "select=*&event_type=in.(pack_unlock_success,pack_unlock_denied,status_changed)",
  "select=*&limit=1&offset=0",
];

async function anonGet(path: string) {
  const ctx = await request.newContext();
  const res = await ctx.get(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
  });
  const status = res.status();
  let body: any = null;
  try { body = await res.json(); } catch { body = await res.text(); }
  await ctx.dispose();
  return { status, body };
}

for (const table of TABLES) {
  for (const q of CRAFTED_QUERIES) {
    test(`anon RLS-bypass attempt "${q}" on ${table} is denied`, async () => {
      const { status, body } = await anonGet(`${table}?${q}`);
      if (status === 200) {
        expect(Array.isArray(body), `expected array for ${table}?${q}`).toBeTruthy();
        expect((body as unknown[]).length, `expected 0 rows for ${table}?${q}`).toBe(0);
      } else {
        expect([400, 401, 403, 404]).toContain(status);
      }
    });
  }
}

test("admin can still read both audit tables (positive control)", async () => {
  const email = process.env.PLAYWRIGHT_ADMIN_EMAIL;
  const password = process.env.PLAYWRIGHT_ADMIN_PASSWORD;
  test.skip(!email || !password, "PLAYWRIGHT_ADMIN_EMAIL/PASSWORD not set");
  const ctx = await request.newContext();
  const auth = await ctx.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: SUPABASE_ANON, "Content-Type": "application/json" },
    data: { email, password },
  });
  test.skip(!auth.ok(), "admin sign-in failed");
  const token = (await auth.json()).access_token as string;

  for (const table of TABLES) {
    const res = await ctx.get(`${SUPABASE_URL}/rest/v1/${table}?select=*&limit=1`, {
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${token}` },
    });
    expect(res.status(), `admin GET ${table}`).toBe(200);
    expect(Array.isArray(await res.json())).toBeTruthy();
  }
  await ctx.dispose();
});
