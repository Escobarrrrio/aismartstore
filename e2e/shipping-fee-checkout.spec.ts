import { test, expect, type Page } from "@playwright/test";

/**
 * Shipping-fee lookup at Checkout (see src/hooks/useShippingSettings.ts).
 *
 * The hook fetches shipping_flat_rate/shipping_zones/shipping_rate_table
 * from store_settings on mount. It has no explicit error handling -- on a
 * failed/aborted request it simply never overwrites the hook's initial
 * DEFAULT_ZONES/DEFAULT_RATE_TABLE state, so Checkout keeps working off
 * those hardcoded fallbacks rather than blocking or crashing. These tests
 * pin that behaviour precisely rather than just checking "a number
 * appears": Eastern Cape (zone "regional", base rate) at 1kg (<=5kg tier,
 * multiplier 1.0) resolves to an exact, computable fee in both the live
 * and the fallback case.
 */

const STORE_SETTINGS_GLOB = "**/rest/v1/store_settings*";

async function addFirstProductToCartAndGoToCheckout(page: Page) {
  await page.goto("/products");
  const addButton = page.getByRole("button", { name: /add .* to cart/i }).first();
  await addButton.waitFor({ state: "visible", timeout: 15_000 });
  await addButton.click();
  await page.goto("/checkout");
  // Checkout redirects to /cart if the cart is empty -- confirm we actually
  // landed on checkout, not bounced back.
  await expect(page).toHaveURL(/\/checkout/);
}

test.describe("Checkout shipping-fee lookup", () => {
  test("uses the live store_settings rate table once fetched, not the hardcoded default", async ({ page }) => {
    let requestSeen = false;
    await page.route(STORE_SETTINGS_GLOB, async (route) => {
      requestSeen = true;
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify([
          { key: "shipping_flat_rate", value: "75" },
          { key: "shipping_zones", value: JSON.stringify({ "Eastern Cape": "regional" }) },
          {
            key: "shipping_rate_table",
            value: JSON.stringify({
              metro: 98, outlying: 128, regional: 777, rest: 195, // distinctive value, not the real default (150)
              weight_tiers: [{ max_kg: 5, multiplier: 1.0 }, { max_kg: 9999, multiplier: 2.0 }],
            }),
          },
        ]),
      });
    });

    await addFirstProductToCartAndGoToCheckout(page);

    // Default province is "Eastern Cape" -> zone "regional" -> base 777,
    // 1 item = 1kg -> <=5kg tier, multiplier 1.0 -> exactly R777.00.
    await expect(page.getByText(/R\s?777(\.00)?/)).toBeVisible({ timeout: 8000 });
    expect(requestSeen).toBe(true);
  });

  test("fee updates when the customer changes province, reflecting the live zone map", async ({ page }) => {
    await page.route(STORE_SETTINGS_GLOB, async (route) => {
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify([
          { key: "shipping_flat_rate", value: "75" },
          { key: "shipping_zones", value: JSON.stringify({ "Eastern Cape": "regional", "Gauteng": "metro" }) },
          {
            key: "shipping_rate_table",
            value: JSON.stringify({
              metro: 321, outlying: 128, regional: 777, rest: 195,
              weight_tiers: [{ max_kg: 5, multiplier: 1.0 }, { max_kg: 9999, multiplier: 2.0 }],
            }),
          },
        ]),
      });
    });

    await addFirstProductToCartAndGoToCheckout(page);
    await expect(page.getByText(/R\s?777(\.00)?/)).toBeVisible({ timeout: 8000 });

    await page.locator('select[name="province"]').selectOption("Gauteng");
    await expect(page.getByText(/R\s?321(\.00)?/)).toBeVisible({ timeout: 5000 });
  });

  test("checkout stays usable and falls back to the default rate table when the shipping API is unavailable", async ({ page }) => {
    await page.route(STORE_SETTINGS_GLOB, (route) => route.abort("failed"));

    await addFirstProductToCartAndGoToCheckout(page);

    // Eastern Cape default province, "regional" default zone, base R150,
    // 1kg <=5kg tier multiplier 1.0 -> exactly R150.00, computed entirely
    // from the hook's hardcoded fallback constants.
    await expect(page.getByText(/R\s?150(\.00)?/)).toBeVisible({ timeout: 8000 });

    // The rest of the checkout form must still be fully usable -- a failed
    // shipping lookup must not block the page or the ability to submit.
    await expect(page.locator('input[name="name"]')).toBeVisible();
    await expect(page.locator('select[name="province"]')).toBeEnabled();
    await expect(page.getByRole("button", { name: /pay/i }).first()).toBeVisible();
  });

  test("checkout stays usable and falls back to the default rate table on a 500 from store_settings", async ({ page }) => {
    await page.route(STORE_SETTINGS_GLOB, (route) =>
      route.fulfill({ status: 500, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: "boom" }) })
    );

    await addFirstProductToCartAndGoToCheckout(page);
    await expect(page.getByText(/R\s?150(\.00)?/)).toBeVisible({ timeout: 8000 });
    await expect(page.locator('select[name="province"]')).toBeEnabled();
  });
});
