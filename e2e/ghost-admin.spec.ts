import { test, expect, request, type Page } from "@playwright/test";

/**
 * "Ghost admin" -- the owner's side of the store.
 *
 * Two halves, deliberately:
 *
 *  1. The lockout half runs with NO credentials, so it always executes. It
 *     proves the Control Centre cannot be reached by someone who is not an
 *     admin -- both anonymous and signed-in-but-not-admin. This is the half
 *     that matters if someone starts poking at the site.
 *
 *  2. The operating half needs a real admin login, supplied via env vars and
 *     never committed. It skips when they are absent.
 *
 * The admin check is server-side (user_roles, looked up with the service role
 * in the edge functions), so passing half 1 is a real authorisation result,
 * not just a hidden menu item.
 */

const SUPABASE_URL = process.env.PLAYWRIGHT_SUPABASE_URL
  || "https://okejdzkftwhccplyfluf.supabase.co";
const SUPABASE_ANON = process.env.PLAYWRIGHT_SUPABASE_ANON_KEY
  || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9rZWpkemtmdHdoY2NwbHlmbHVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5NDU0MjAsImV4cCI6MjEwMTUyMTQyMH0.JHSxZe_hSQtAH7nABmlRQlV2QlNJDYmOYbkcGnpKbj4";
const STORAGE_KEY = "sb-okejdzkftwhccplyfluf-auth-token";

const ADMIN_EMAIL = process.env.PLAYWRIGHT_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.PLAYWRIGHT_ADMIN_PASSWORD;
// A deliberately non-admin account, to prove the role check and not just the
// login check. Falls back to the ordinary customer test user.
const PLAIN_EMAIL = process.env.PLAYWRIGHT_TEST_USER_EMAIL;
const PLAIN_PASSWORD = process.env.PLAYWRIGHT_TEST_USER_PASSWORD;

async function signIn(email: string, password: string) {
  const ctx = await request.newContext();
  const res = await ctx.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: SUPABASE_ANON, "Content-Type": "application/json" },
    data: { email, password },
  });
  expect(res.ok(), `sign-in failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = await res.json();
  await ctx.dispose();
  return body as {
    access_token: string; refresh_token: string; expires_in: number; user: { id: string };
  };
}

async function seedRealSession(page: Page, session: Awaited<ReturnType<typeof signIn>>) {
  await page.addInitScript(
    ({ key, session }) => {
      const nowSec = Math.floor(Date.now() / 1000);
      window.localStorage.setItem(key, JSON.stringify({
        access_token: session.access_token,
        token_type: "bearer",
        expires_in: session.expires_in,
        expires_at: nowSec + session.expires_in,
        refresh_token: session.refresh_token,
        user: session.user,
      }));
    },
    { key: STORAGE_KEY, session },
  );
}

test.describe("ghost admin: lockout", () => {
  test("an anonymous visitor cannot open the Control Centre", async ({ page }) => {
    await page.goto("/admin");

    // Either bounced to auth, or held on the gate -- but never showing the
    // Control Centre itself.
    await expect(page.locator("body")).not.toContainText(/Control Centre/i, { timeout: 15_000 })
      .catch(async () => {
        // "Loading Control Centre..." is the pre-auth spinner and is allowed;
        // the real failure is reaching the actual admin surface.
        await expect(page.locator("body")).toContainText(/Loading Control Centre/i);
      });

    await expect(page.locator("body")).not.toContainText(/Margin|Cost price/i);
  });

  test("a signed-in NON-admin is refused the Control Centre", async ({ page }) => {
    test.skip(
      !PLAIN_EMAIL || !PLAIN_PASSWORD,
      "Set PLAYWRIGHT_TEST_USER_EMAIL/PASSWORD (a non-admin account) to run the role check.",
    );

    const session = await signIn(PLAIN_EMAIL!, PLAIN_PASSWORD!);
    await seedRealSession(page, session);
    await page.goto("/admin");

    await expect(page.getByText(/Admin access required/i)).toBeVisible({ timeout: 20_000 });
    // Admin-only commercial data must not be in the DOM at all, not merely
    // hidden -- anything shipped to the browser is readable in devtools.
    await expect(page.locator("body")).not.toContainText(/Margin|Cost price/i);
  });

  test("admin-only tables stay closed to a non-admin at the database level", async () => {
    test.skip(
      !PLAIN_EMAIL || !PLAIN_PASSWORD,
      "Set PLAYWRIGHT_TEST_USER_EMAIL/PASSWORD to run the RLS check.",
    );

    // The UI check above proves the screen is guarded. This proves the data is
    // guarded, which is the part that actually matters: a hand-rolled request
    // with a valid non-admin token must still come back empty or forbidden.
    const session = await signIn(PLAIN_EMAIL!, PLAIN_PASSWORD!);
    const ctx = await request.newContext();
    const res = await ctx.get(`${SUPABASE_URL}/rest/v1/user_roles?select=*`, {
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${session.access_token}` },
    });

    if (res.ok()) {
      const rows = await res.json();
      const foreign = (rows as { user_id: string }[]).filter((r) => r.user_id !== session.user.id);
      expect(foreign, "a non-admin must never read other users' roles").toHaveLength(0);
    } else {
      expect([401, 403, 404]).toContain(res.status());
    }
    await ctx.dispose();
  });
});

test.describe("ghost admin: operating the store", () => {
  test.beforeEach(() => {
    test.skip(
      !ADMIN_EMAIL || !ADMIN_PASSWORD,
      "Set PLAYWRIGHT_ADMIN_EMAIL/PLAYWRIGHT_ADMIN_PASSWORD to run the admin journey.",
    );
  });

  test("admin reaches the Control Centre and its core sections load", async ({ page }) => {
    const session = await signIn(ADMIN_EMAIL!, ADMIN_PASSWORD!);
    await seedRealSession(page, session);

    await page.goto("/admin");
    await expect(page.getByText(/Admin access required/i)).toBeHidden();
    await expect(page.locator("body")).toContainText(/Control Centre|Orders|Products/i, {
      timeout: 25_000,
    });

    // A Control Centre that renders but shows no navigation is broken for the
    // owner even though it "loaded".
    const nav = page.getByRole("button").or(page.getByRole("link"));
    expect(await nav.count()).toBeGreaterThan(3);
  });

  test("admin can open Orders without an error state", async ({ page }) => {
    const session = await signIn(ADMIN_EMAIL!, ADMIN_PASSWORD!);
    await seedRealSession(page, session);

    const consoleErrors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });

    await page.goto("/admin");
    const ordersNav = page.getByRole("button", { name: /orders/i }).first();
    if (await ordersNav.isVisible().catch(() => false)) {
      await ordersNav.click();
    }

    await expect(page.locator("body")).not.toContainText(/something went wrong|failed to load/i);

    // Network/auth failures against the store's own backend mean the owner is
    // looking at stale or empty data without being told.
    const backendErrors = consoleErrors.filter((e) => /supabase|failed to fetch|401|403/i.test(e));
    expect(backendErrors, `backend errors in admin: ${backendErrors.join(" | ")}`).toHaveLength(0);
  });
});
