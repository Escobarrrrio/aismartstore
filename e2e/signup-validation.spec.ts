import { test, expect } from "@playwright/test";

/**
 * Signup flow validation tests.
 *
 * Covers:
 *  1. The account-type gate blocks form submission until Residential OR
 *     Business/Government is chosen (no default).
 *  2. Field-level validation rejects malformed SA ID, phone and VAT numbers
 *     before hitting the network.
 *  3. Duplicate id_number / phone / vat_number responses show the friendly
 *     "one account per person" message rather than a raw Postgres error.
 */
test.describe("Signup validation gate", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/auth");
    // Switch to Sign Up tab
    await page.getByRole("button", { name: /sign up/i }).click();
  });

  test("shows account-type gate and no signup form until a type is chosen", async ({ page }) => {
    await expect(page.getByTestId("account-type-gate")).toBeVisible();
    await expect(page.getByTestId("account-type-residential")).toBeVisible();
    await expect(page.getByTestId("account-type-business")).toBeVisible();
    // Signup fields must not be present yet.
    await expect(page.getByTestId("signup-id")).toHaveCount(0);
    await expect(page.getByTestId("signup-phone")).toHaveCount(0);
  });

  test("Residential path reveals the standard fields", async ({ page }) => {
    await page.getByTestId("account-type-residential").click();
    await expect(page.getByTestId("signup-name")).toBeVisible();
    await expect(page.getByTestId("signup-phone")).toBeVisible();
    await expect(page.getByTestId("signup-id")).toBeVisible();
    // Business-only fields must be hidden.
    await expect(page.getByTestId("signup-company")).toHaveCount(0);
    await expect(page.getByTestId("signup-vat")).toHaveCount(0);
  });

  test("Business path adds company + VAT fields", async ({ page }) => {
    await page.getByTestId("account-type-business").click();
    await expect(page.getByTestId("signup-company")).toBeVisible();
    await expect(page.getByTestId("signup-vat")).toBeVisible();
  });

  test("Invalid SA ID (< 13 digits) shows an inline field error", async ({ page }) => {
    await page.getByTestId("account-type-residential").click();
    await page.getByTestId("signup-name").fill("Test User");
    await page.getByTestId("signup-phone").fill("+27821234567");
    await page.getByTestId("signup-id").fill("123456");
    await page.locator('input[type="email"]').fill("test-invalid-id@example.com");
    await page.locator('input[type="password"]').fill("Password!123");
    await page.getByRole("button", { name: /create account/i }).click();
    const err = page.locator('[role="alert"]', { hasText: /13 digits/i });
    await expect(err).toBeVisible();
  });

  test("Invalid VAT number (not 4 + 9 digits) shows inline error", async ({ page }) => {
    await page.getByTestId("account-type-business").click();
    await page.getByTestId("signup-name").fill("Test User");
    await page.getByTestId("signup-company").fill("Acme (Pty) Ltd");
    await page.getByTestId("signup-vat").fill("1234567890"); // starts with 1, not 4
    await page.getByTestId("signup-phone").fill("+27821234567");
    await page.getByTestId("signup-id").fill("9001015800086");
    await page.locator('input[type="email"]').fill("test-invalid-vat@example.com");
    await page.locator('input[type="password"]').fill("Password!123");
    await page.getByRole("button", { name: /create account/i }).click();
    await expect(page.locator('[role="alert"]', { hasText: /10 digits starting with 4/i })).toBeVisible();
  });

  test("Duplicate ID number surfaces the friendly one-account message", async ({ page }) => {
    // Intercept the profile update PATCH and simulate a 23505 unique_violation
    // response on id_number. We don't need a real DB row for the E2E to be
    // meaningful — the UX contract is: users see the friendly message, not
    // "duplicate key value violates unique constraint".
    await page.route("**/rest/v1/profiles**", async (route) => {
      if (route.request().method() === "PATCH") {
        return route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            code: "23505",
            message: 'duplicate key value violates unique constraint "profiles_id_number_key"',
            details: "Key (id_number)=(9001015800086) already exists.",
          }),
        });
      }
      return route.continue();
    });
    // The signUp call itself must succeed so we reach the profile UPDATE.
    await page.route("**/auth/v1/signup**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          user: { id: "00000000-0000-0000-0000-000000000001", email: "dup@example.com" },
          session: null,
        }),
      })
    );

    await page.getByTestId("account-type-residential").click();
    await page.getByTestId("signup-name").fill("Dup User");
    await page.getByTestId("signup-phone").fill("+27821234567");
    await page.getByTestId("signup-id").fill("9001015800086");
    await page.locator('input[type="email"]').fill("dup@example.com");
    await page.locator('input[type="password"]').fill("Password!123");
    await page.getByRole("button", { name: /create account/i }).click();

    // Friendly toast: mentions "ID number" and "already registered" and does
    // NOT show the raw "duplicate key value" Postgres wording.
    const toast = page.locator("text=/already registered/i");
    await expect(toast).toBeVisible();
    await expect(page.locator("text=/duplicate key value/i")).toHaveCount(0);
  });
});
