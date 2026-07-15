import { test, expect } from "@playwright/test";

/**
 * Audience guard: a residential customer visiting /procurement (direct URL
 * access) must see the friendly "not available on your account" message
 * instead of the business portal. This is the client-side product-relevance
 * gate — the underlying compliance pack / cost pricing is separately
 * protected server-side via RLS and security-definer RPCs.
 *
 * We simulate a residential session by seeding the Supabase auth token in
 * localStorage AND intercepting the profiles lookup to return
 * customer_type=residential. This keeps the test hermetic — no real user
 * required.
 */

test.describe("Residential visitor blocked from /procurement", () => {
  test("shows the guard message and hides business content", async ({ page, context }) => {
    // Fake session token — the app only reads user.id from it.
    const fakeSession = {
      access_token: "test-token",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: "test-refresh",
      user: { id: "11111111-1111-1111-1111-111111111111", email: "res@test.local" },
    };
    await context.addInitScript((session) => {
      // Supabase JS looks for sb-<ref>-auth-token; the exact key varies per
      // project. Write both a specific key and the generic one so whichever
      // the client reads finds a session.
      const payload = JSON.stringify(session);
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith("sb-") && k.endsWith("-auth-token")) localStorage.setItem(k, payload);
      }
      localStorage.setItem("supabase.auth.token", payload);
    }, fakeSession);

    // Intercept the profile lookup — return residential.
    await page.route("**/rest/v1/profiles*", (route) => {
      if (route.request().method() === "GET") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([{ customer_type: "residential" }]),
        });
      }
      return route.continue();
    });
    // Not an admin.
    await page.route("**/rest/v1/user_roles*", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "[]" })
    );

    await page.goto("/procurement");
    // Guard message content.
    await expect(page.locator("text=/isn't available on your account/i")).toBeVisible();
    await expect(page.locator("text=/Residential/i")).toBeVisible();
    // Business portal hero should NOT render.
    await expect(page.locator("text=/CSD Supplier/i")).toHaveCount(0);
  });

  test("Anonymous visitor is NOT blocked (they haven't declared a type)", async ({ page }) => {
    await page.goto("/procurement");
    // Guard message must NOT appear for anonymous visitors.
    await expect(page.locator("text=/isn't available on your account/i")).toHaveCount(0);
  });
});
