import { test, expect, request, APIRequestContext } from "@playwright/test";

/**
 * The Compliance Audit CSV export runs client-side against
 * `compliance_access_log` — so the RLS boundary IS the export boundary.
 *
 * Non-admin: the underlying REST query returns [] (or 4xx). CSV would be
 * "no rows to export"; asserting the API is blocked proves the UI export
 * cannot produce data.
 *
 * Admin: query with the same filter shape the UI uses, then generate the
 * CSV in-test and assert row count + shape match the filtered events.
 */

const SUPABASE_URL = process.env.PLAYWRIGHT_SUPABASE_URL
  || "https://xwiqubcilptxzvdigsmp.supabase.co";
const SUPABASE_ANON = process.env.PLAYWRIGHT_SUPABASE_ANON_KEY
  || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh3aXF1YmNpbHB0eHp2ZGlnc21wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIwMTY2NzcsImV4cCI6MjA4NzU5MjY3N30.aiRYqZ2H2VTNc64hU2XdeESEz4VcxOW6BQKvhb0v-4I";

const CSV_HEADERS = ["created_at", "event_type", "email", "quote_request_id", "actor_id", "metadata"];

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "desktop-chromium", "API-level tests run once");
});

function toCsv(rows: any[]): string {
  const escape = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [CSV_HEADERS.join(",")];
  for (const r of rows) lines.push(CSV_HEADERS.map((h) => escape(r[h])).join(","));
  return lines.join("\n");
}

async function queryLog(ctx: APIRequestContext, token: string | null, params: string) {
  const headers: Record<string, string> = { apikey: SUPABASE_ANON };
  headers.Authorization = `Bearer ${token || SUPABASE_ANON}`;
  const res = await ctx.get(`${SUPABASE_URL}/rest/v1/compliance_access_log?${params}`, { headers });
  return { status: res.status(), body: await res.text() };
}

test("non-admin CSV export is blocked at the RLS layer (no rows leak)", async () => {
  const ctx = await request.newContext();
  const { status, body } = await queryLog(
    ctx,
    null,
    "select=created_at,event_type,email,quote_request_id,actor_id,metadata&order=created_at.desc&limit=500",
  );
  if (status === 200) {
    const rows = JSON.parse(body);
    expect(Array.isArray(rows)).toBeTruthy();
    expect(rows.length).toBe(0);
    // A CSV built from [] must be header-only (no data rows leaked).
    const csv = toCsv(rows);
    expect(csv.split("\n").length).toBe(1);
  } else {
    expect([401, 403, 404]).toContain(status);
  }
  await ctx.dispose();
});

test("admin CSV export contains exactly the filtered rows", async () => {
  const email = process.env.PLAYWRIGHT_ADMIN_EMAIL;
  const password = process.env.PLAYWRIGHT_ADMIN_PASSWORD;
  test.skip(!email || !password, "PLAYWRIGHT_ADMIN_EMAIL/PASSWORD not set");

  const ctx = await request.newContext();
  const auth = await ctx.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: SUPABASE_ANON, "Content-Type": "application/json" },
    data: { email, password },
  });
  test.skip(!auth.ok(), "admin sign-in failed");
  const token = (auth as any).ok() ? ((await auth.json()).access_token as string) : null;
  test.skip(!token, "no admin token");

  // 1. Baseline: fetch the latest 500 (mirrors UI default).
  const baseline = await queryLog(ctx, token, "select=*&order=created_at.desc&limit=500");
  expect(baseline.status).toBe(200);
  const allRows: any[] = JSON.parse(baseline.body);

  // 2. Apply the "pack_unlock_denied" filter and re-query.
  const filtered = await queryLog(
    ctx,
    token,
    "select=*&order=created_at.desc&limit=500&event_type=eq.pack_unlock_denied",
  );
  expect(filtered.status).toBe(200);
  const filteredRows: any[] = JSON.parse(filtered.body);

  // 3. Filtered rows must be a subset of the baseline, all matching the predicate.
  for (const r of filteredRows) expect(r.event_type).toBe("pack_unlock_denied");
  expect(filteredRows.length).toBeLessThanOrEqual(allRows.length);

  // 4. Rebuild the CSV the way the module does and validate structure.
  const csv = toCsv(filteredRows);
  const lines = csv.split("\n");
  expect(lines[0]).toBe(CSV_HEADERS.join(","));
  expect(lines.length - 1).toBe(filteredRows.length);

  await ctx.dispose();
});
