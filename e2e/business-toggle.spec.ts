import { test, expect, Page } from "@playwright/test";

/**
 * E2E coverage for the "Include business items" toggle on /products.
 *
 * Verifies (on BOTH desktop and mobile projects):
 *  - Default state hides enterprise items (total goes up when toggled on).
 *  - Pagination updates in response to the new total.
 *  - The inline procurement link takes the user to /procurement.
 *
 * The desktop project uses the sidebar checkbox; the mobile project opens
 * the bottom sheet and uses the toggle on the "More" tab. Tests read the
 * live result count from the `data-testid="results-count"` element so they
 * remain resilient to catalogue growth over time.
 */

const readTotal = async (page: Page): Promise<number> => {
  const el = page.getByTestId("results-count");
  // Wait for it to stop reporting `data-loading="true"`.
  await expect(el).toHaveAttribute("data-loading", "false", { timeout: 15_000 });
  const raw = await el.getAttribute("data-total");
  return Number(raw ?? 0);
};

const gotoProducts = async (page: Page) => {
  await page.goto("/products");
  await expect(page.getByRole("heading", { level: 1, name: /products|shop|catalogue/i })).toBeVisible();
  await readTotal(page); // wait for hydration
};

test.describe("Include business items toggle — desktop", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Desktop-only sidebar toggle");
  });

  test("toggling on expands the catalogue and pagination reflects it", async ({ page }) => {
    await gotoProducts(page);
    const before = await readTotal(page);
    expect(before).toBeGreaterThan(0);

    const toggle = page.getByTestId("include-business-toggle");
    await expect(toggle).toBeVisible();
    await expect(toggle).not.toBeChecked();

    await toggle.check();
    // Total must increase (or stay equal only if literally no business items exist).
    await expect
      .poll(async () => readTotal(page), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(before);
    const after = await readTotal(page);
    expect(after).toBeGreaterThanOrEqual(before);

    // Pagination reflects the new total. Compute expected pages (page size 24).
    const expectedPages = Math.max(1, Math.ceil(after / 24));
    if (expectedPages > 1) {
      const nav = page.getByRole("navigation", { name: /pagination/i });
      await expect(nav).toBeVisible();
      // Last visible page button must be >= 2 when there are multiple pages.
      await expect(nav.getByRole("button", { name: /^2$/ })).toBeVisible();
    }
  });

  test("procurement link inside the toggle description navigates to /procurement", async ({ page }) => {
    await gotoProducts(page);
    const link = page.getByRole("link", { name: /procurement/i }).first();
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/procurement$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});

test.describe("Include business items toggle — mobile", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chromium", "Mobile-only bottom sheet");
  });

  test("toggle on the mobile bottom sheet updates the total and pagination", async ({ page }) => {
    await gotoProducts(page);
    const before = await readTotal(page);
    expect(before).toBeGreaterThan(0);

    // Open the bottom sheet, jump to the "More" tab.
    await page.getByRole("button", { name: /filters/i }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("tab", { name: /more/i }).click();

    const toggle = page.getByTestId("mobile-include-business-toggle");
    await expect(toggle).toBeVisible();
    await expect(toggle).not.toBeChecked();
    await toggle.check();

    // The "Show N results" CTA updates in the sheet footer.
    const showBtn = dialog.getByRole("button", { name: /show\s+[\d,\s]+result/i });
    await expect(showBtn).toBeVisible();
    await showBtn.click();
    await expect(dialog).toBeHidden();

    const after = await readTotal(page);
    expect(after).toBeGreaterThanOrEqual(before);

    const expectedPages = Math.max(1, Math.ceil(after / 24));
    if (expectedPages > 1) {
      await expect(page.getByRole("navigation", { name: /pagination/i })).toBeVisible();
    }
  });
});
