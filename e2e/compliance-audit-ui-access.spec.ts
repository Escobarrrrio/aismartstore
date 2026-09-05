import { test, expect, request } from "@playwright/test";

/**
 * Verifies non-admin users:
 *   - cannot see the Compliance Audit module UI (Admin page renders the
 *     "Admin access required" gate)
 *   - anonymous visits to /admin get bounced to /auth
 * And that admin users can render the Compliance Audit module.
 */

const SUPABASE_URL = process.env.PLAYWRIGHT_SUPABASE_URL
  || "https://okejdzkftwhccplyfluf.supabase.co";
const SUPABASE_ANON = process.env.PLAYWRIGHT_SUPABASE_ANON_KEY
  || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9rZWpkemtmdHdoY2NwbHlmbHVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5NDU0MjAsImV4cCI6MjEwMTUyMTQyMH0.JHSxZe_hSQtAH7nABmlRQlV2QlNJDYmOYbkcGnpKbj4";

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "desktop-chromium", "UI gate test runs once");
});

test("anonymous visit to /admin is redirected to /auth", async ({ page }) => {
  await page.goto("/admin");
  await page.waitForURL(/\/auth/, { timeout: 10_000 });
  expect(page.url()).toContain("/auth");
});

async function signInSupabase(email: string, password: string) {
  const ctx = await request.newContext();
  const res = await ctx.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: SUPABASE_ANON, "Content-Type": "application/json" },
    data: { email, password },
  });
  if (!res.ok()) { await ctx.dispose(); return null; }
  const json = await res.json();
  await ctx.dispose();
  return json;
}

async function seedSession(page: any, session: any) {
  // Match the storage key the Supabase JS client uses in the app.
  const key = `sb-${new URL(SUPABASE_URL).hostname.split(".")[0]}-auth-token`;
  await page.addInitScript(([k, s]: [string, string]) => {
    window.localStorage.setItem(k, s);
  }, [key, JSON.stringify({ currentSession: session, expiresAt: session.expires_at })]);
}

test("signed-in non-admin sees the access-required gate, not compliance data", async ({ page }) => {
  const email = process.env.PLAYWRIGHT_USER_EMAIL;
  const password = process.env.PLAYWRIGHT_USER_PASSWORD;
  test.skip(!email || !password, "PLAYWRIGHT_USER_EMAIL/PASSWORD not set");

  const session = await signInSupabase(email!, password!);
  test.skip(!session, "non-admin credentials failed to authenticate");

  await seedSession(page, session);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: /admin access required/i })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/Compliance Audit/i)).toHaveCount(0);
});

test("admin can open the Compliance Audit module", async ({ page }) => {
  const email = process.env.PLAYWRIGHT_ADMIN_EMAIL;
  const password = process.env.PLAYWRIGHT_ADMIN_PASSWORD;
  test.skip(!email || !password, "PLAYWRIGHT_ADMIN_EMAIL/PASSWORD not set");

  const session = await signInSupabase(email!, password!);
  test.skip(!session, "admin credentials failed to authenticate");

  await seedSession(page, session);
  await page.goto("/admin");
  // Sidebar renders; click the Compliance Audit tab.
  const tab = page.getByRole("button", { name: /compliance audit/i }).first();
  await tab.click({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: /export csv/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /apply filters/i })).toBeVisible();
});
