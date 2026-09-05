import { test, expect, request, type Page } from "@playwright/test";

/**
 * End-to-end: a signed-in customer can save a product from the catalogue,
 * see it persisted server-side (not just optimistic UI), find it under
 * Account -> Saved Items, and remove it from there too.
 *
 * Runs against the real live backend with a real signed-in session (same
 * pattern as order-email-notification.spec.ts) so RLS on the `wishlists`
 * table is exercised for real, not faked.
 */

const SUPABASE_URL = process.env.PLAYWRIGHT_SUPABASE_URL
  || "https://okejdzkftwhccplyfluf.supabase.co";
const SUPABASE_ANON = process.env.PLAYWRIGHT_SUPABASE_ANON_KEY
  || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9rZWpkemtmdHdoY2NwbHlmbHVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5NDU0MjAsImV4cCI6MjEwMTUyMTQyMH0.JHSxZe_hSQtAH7nABmlRQlV2QlNJDYmOYbkcGnpKbj4";
const PROJECT_REF = "okejdzkftwhccplyfluf";
const STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`;

const TEST_EMAIL = process.env.PLAYWRIGHT_TEST_USER_EMAIL;
const TEST_PASSWORD = process.env.PLAYWRIGHT_TEST_USER_PASSWORD;

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "desktop-chromium", "API-backed test runs once");
  test.skip(
    !TEST_EMAIL || !TEST_PASSWORD,
    "Set PLAYWRIGHT_TEST_USER_EMAIL/PLAYWRIGHT_TEST_USER_PASSWORD to run wishlist E2E.",
  );
});

async function signIn() {
  const ctx = await request.newContext();
  const res = await ctx.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: SUPABASE_ANON, "Content-Type": "application/json" },
    data: { email: TEST_EMAIL, password: TEST_PASSWORD },
  });
  expect(res.ok(), `sign-in failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = await res.json();
  await ctx.dispose();
  return body as { access_token: string; refresh_token: string; expires_in: number; user: { id: string } };
}

// Seeds a REAL, cryptographically valid session (not a fake token) so that
// supabase-js resolves it synchronously and RLS-backed writes made through
// the real UI succeed exactly as they would for a real customer.
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

test("customer can save a product to their wishlist and manage it from Account", async ({ page }) => {
  const session = await signIn();
  const ctx = await request.newContext();
  const authed = { apikey: SUPABASE_ANON, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" };

  // Clean slate for this test user so the assertion isn't polluted by a
  // previous run's leftover row.
  await ctx.delete(`${SUPABASE_URL}/rest/v1/wishlists?user_id=eq.${session.user.id}`, { headers: authed });

  const prodRes = await ctx.get(
    `${SUPABASE_URL}/rest/v1/products?is_active=eq.true&select=id,name,images&limit=30`,
    { headers: authed },
  );
  const candidates = (await prodRes.json() as any[]).filter((p) => Array.isArray(p.images) && p.images[0]);
  expect(candidates.length, "need at least one active product with an image").toBeGreaterThan(0);
  const product = candidates[0];

  await seedRealSession(page, session);
  await page.goto(`/product/${product.id}`);

  const addButton = page.getByRole("button", { name: `Add ${product.name} to wishlist` });
  await expect(addButton).toBeVisible();
  await addButton.click();
  await expect(page.getByRole("button", { name: `Remove ${product.name} from wishlist` })).toBeVisible();

  // Confirm it's actually persisted server-side, not just optimistic UI.
  await expect.poll(async () => {
    const res = await ctx.get(
      `${SUPABASE_URL}/rest/v1/wishlists?user_id=eq.${session.user.id}&product_id=eq.${product.id}&select=id`,
      { headers: authed },
    );
    return (await res.json() as any[]).length;
  }, { timeout: 5000 }).toBe(1);

  // Shows up under Account -> Saved Items.
  await page.goto("/account");
  await page.getByRole("button", { name: "Saved Items" }).click();
  await expect(page.getByText(product.name, { exact: false }).first()).toBeVisible();

  // Removing it there deletes the row and the empty state returns.
  await page.getByRole("button", { name: `Remove ${product.name} from wishlist` }).first().click();
  await expect(page.getByText("Your wishlist is empty")).toBeVisible();
  await expect.poll(async () => {
    const res = await ctx.get(
      `${SUPABASE_URL}/rest/v1/wishlists?user_id=eq.${session.user.id}&product_id=eq.${product.id}&select=id`,
      { headers: authed },
    );
    return (await res.json() as any[]).length;
  }, { timeout: 5000 }).toBe(0);

  await ctx.dispose();
});

test("signed-out visitor is prompted to sign in instead of silently failing", async ({ page }) => {
  const ctx = await request.newContext();
  const prodRes = await ctx.get(`${SUPABASE_URL}/rest/v1/products?is_active=eq.true&select=id,name,images&limit=30`, {
    headers: { apikey: SUPABASE_ANON },
  });
  const candidates = (await prodRes.json() as any[]).filter((p) => Array.isArray(p.images) && p.images[0]);
  expect(candidates.length).toBeGreaterThan(0);
  const product = candidates[0];
  await ctx.dispose();

  await page.goto(`/product/${product.id}`);
  const addButton = page.getByRole("button", { name: `Add ${product.name} to wishlist` });
  await addButton.click();

  await expect(page.getByText("Sign in to save items")).toBeVisible();
  // Button state must not silently flip to "saved" for a visitor with no
  // account to persist it against.
  await expect(page.getByRole("button", { name: `Add ${product.name} to wishlist` })).toBeVisible();
});
