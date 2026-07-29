import { test, expect, Page } from "@playwright/test";

/**
 * E2E coverage for the catalogue scope control on /products.
 *
 * This replaces the old `business-toggle.spec.ts`, which drove a
 * `data-testid="include-business-toggle"` element that was never rendered
 * anywhere in `src/` — the "Include business items" state existed in
 * Products.tsx but was never passed to the search RPC, so the control was
 * decorative and its spec could not have passed.
 *
 * Scope is now a real, URL-addressable filter (`?audience=`), so these tests
 * assert against observable behaviour: the result total changes, the URL
 * carries the scope, and a deep link restores it.
 *
 * Totals are read from `data-testid="results-count"` so the assertions stay
 * valid as the catalogue grows.
 */

const readTotal = async (page: Page): Promise<number> => {
  const el = page.getByTestId("results-count");
  await expect(el).toHaveAttribute("data-loading", "false", { timeout: 20_000 });
  return Number((await el.getAttribute("data-total")) ?? 0);
};

const gotoProducts = async (page: Page, url = "/products") => {
  await page.goto(url);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await readTotal(page);
};

test.describe("catalogue scope — desktop", () => {
  test.beforeEach((_fixtures, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Desktop-only sidebar control");
  });

  test("switching to Business changes the result set and the URL", async ({ page }) => {
    await gotoProducts(page);
    const residential = await readTotal(page);
    expect(residential).toBeGreaterThan(0);

    await expect(page.getByTestId("scope-residential")).toHaveAttribute("aria-checked", "true");
    await page.getByTestId("scope-business").click();

    await expect
      .poll(async () => new URL(page.url()).searchParams.get("audience"), { timeout: 15_000 })
      .toBe("business");

    const business = await readTotal(page);
    expect(business).toBeGreaterThan(0);
    // The two catalogues are disjoint slices, so the totals must differ.
    expect(business).not.toBe(residential);
  });

  test("Everything scope is at least as large as either single scope", async ({ page }) => {
    await gotoProducts(page);
    const residential = await readTotal(page);

    await page.getByTestId("scope-business").click();
    await expect.poll(async () => readTotal(page), { timeout: 15_000 }).toBeGreaterThan(0);
    const business = await readTotal(page);

    await page.getByTestId("scope-all").click();
    await expect
      .poll(async () => readTotal(page), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(Math.max(residential, business));
  });

  test("a deep link restores the business scope", async ({ page }) => {
    await gotoProducts(page, "/products?audience=business");
    await expect(page.getByTestId("scope-business")).toHaveAttribute("aria-checked", "true");
    expect(await readTotal(page)).toBeGreaterThan(0);
  });

  test("facet counts agree with the grid total", async ({ page }) => {
    // The core guarantee: a sidebar count is exactly what clicking it yields.
    await gotoProducts(page);
    const firstCategory = page
      .locator('aside button[aria-pressed]')
      .filter({ hasNot: page.locator("[disabled]") })
      .first();
    await expect(firstCategory).toBeVisible();

    const countText = await firstCategory.locator("span").last().innerText();
    const advertised = Number(countText.replace(/\D/g, ""));
    test.skip(!Number.isFinite(advertised) || advertised === 0, "No countable facet available");

    await firstCategory.click();
    await expect.poll(async () => readTotal(page), { timeout: 15_000 }).toBe(advertised);
  });

  test("the procurement link navigates to the Business Portal", async ({ page }) => {
    await gotoProducts(page);
    const link = page.getByRole("link", { name: /business portal/i }).first();
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/procurement$/);
  });
});

test.describe("catalogue scope — mobile", () => {
  test.beforeEach((_fixtures, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chromium", "Mobile-only bottom sheet");
  });

  test("scope control in the bottom sheet updates the total", async ({ page }) => {
    await gotoProducts(page);
    const before = await readTotal(page);
    expect(before).toBeGreaterThan(0);

    await page.getByRole("button", { name: /filters/i }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("tab", { name: /more/i }).click();

    await dialog.getByTestId("mobile-scope-business").click();

    const showBtn = dialog.getByRole("button", { name: /show\s+[\d,\s]+result/i });
    await expect(showBtn).toBeVisible();
    await showBtn.click();
    await expect(dialog).toBeHidden();

    await expect
      .poll(async () => new URL(page.url()).searchParams.get("audience"), { timeout: 15_000 })
      .toBe("business");
    expect(await readTotal(page)).toBeGreaterThan(0);
  });
});
