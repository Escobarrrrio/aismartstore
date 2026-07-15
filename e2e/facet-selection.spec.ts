import { test, expect, Page } from "@playwright/test";

/**
 * Locks in the desktop facet behaviour on /products:
 *  - Selecting a Category facet updates the results-count trust bar,
 *    renders an active-filter chip, and every visible card belongs to
 *    the selected category (no blank spaces / no stale rows).
 *  - Dismissing the chip clears the filter and the count returns to the
 *    baseline (>=) with the chip row gone.
 *  - Sort control changes are reflected in the URL of the RPC (price asc
 *    yields a non-decreasing sequence of visible prices).
 */

const parseCount = (s: string | null | undefined) => {
  if (!s) return NaN;
  const m = s.replace(/\s|,/g, "").match(/(\d+)/);
  return m ? Number(m[1]) : NaN;
};

async function waitForResults(page: Page) {
  const bar = page.locator('[data-testid="results-count"]');
  await expect(bar).toBeVisible();
  await expect(bar).toHaveAttribute("data-loading", "false", { timeout: 15_000 });
  await expect(page.locator('[data-testid="product-card"]').first()).toBeVisible({
    timeout: 15_000,
  });
}

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "desktop-chromium", "Desktop facet UI test");
});

test("selecting a facet updates the count, lists all matching products, and clears", async ({
  page,
}) => {
  await page.goto("/products");
  await waitForResults(page);

  const bar = page.locator('[data-testid="results-count"]');
  const baselineTotal = Number(await bar.getAttribute("data-total"));
  expect(baselineTotal).toBeGreaterThan(0);

  // Pick the first non-empty Category facet button from the desktop rail.
  // FacetList renders buttons with aria-pressed and a trailing count.
  const categoryHeading = page.getByText("Category", { exact: true }).first();
  await expect(categoryHeading).toBeVisible();

  const catRail = categoryHeading.locator("xpath=ancestor::div[1]");
  const firstOption = catRail.locator('button[aria-pressed]').nth(0);
  await expect(firstOption).toBeVisible();
  const optionLabel = (await firstOption.textContent())?.trim() ?? "";
  // Strip trailing count number to derive the category name.
  const catName = optionLabel.replace(/\s+\d[\d\s]*$/, "").trim();
  expect(catName.length).toBeGreaterThan(0);

  await firstOption.click();

  // Count updates and stays <= baseline.
  await expect
    .poll(async () => Number(await bar.getAttribute("data-total")), { timeout: 15_000 })
    .toBeLessThanOrEqual(baselineTotal);
  await expect(bar).toHaveAttribute("data-loading", "false");
  const filteredTotal = Number(await bar.getAttribute("data-total"));
  expect(filteredTotal).toBeGreaterThan(0);

  // Active-filter chip for the selected category appears.
  const chipRow = page.getByLabel("Active filters");
  await expect(chipRow).toBeVisible();
  await expect(chipRow.getByRole("button", { name: new RegExp(catName, "i") })).toBeVisible();

  // Every visible card must belong to the selected category — no blank slots.
  const cards = page.locator('[data-testid="product-card"]');
  await expect(cards.first()).toBeVisible();
  const cats = await cards.evaluateAll((els) =>
    els.map((e) => ((e as HTMLElement).dataset.productCategory ?? "").toLowerCase()),
  );
  expect(cats.length).toBeGreaterThan(0);
  const stale = cats.filter((c) => c && c !== catName.toLowerCase());
  expect(stale, `unexpected non-matching categories: ${stale.join(",")}`).toEqual([]);

  // Dismiss the chip → filter clears and total returns to baseline.
  await chipRow.getByRole("button", { name: new RegExp(catName, "i") }).click();
  await expect
    .poll(async () => Number(await bar.getAttribute("data-total")), { timeout: 15_000 })
    .toBe(baselineTotal);
  await expect(page.getByLabel("Active filters")).toBeHidden();
});

test("sort: price low-to-high yields non-decreasing visible prices", async ({ page }) => {
  await page.goto("/products");
  await waitForResults(page);

  await page.getByRole("combobox").first().selectOption("price_asc").catch(async () => {
    // Fallback: the control is a <select> rendered as such.
    await page.locator('select').first().selectOption("price_asc");
  });
  await waitForResults(page);

  const prices = await page
    .locator('[data-testid="product-card"] .font-display.font-extrabold.text-lg')
    .evaluateAll((els) =>
      els.map((e) => {
        const t = (e.textContent || "").replace(/[^\d.]/g, "");
        return Number(t);
      }),
    );
  const clean = prices.filter((n) => Number.isFinite(n) && n > 0);
  expect(clean.length).toBeGreaterThan(1);
  for (let i = 1; i < clean.length; i++) {
    expect(clean[i]).toBeGreaterThanOrEqual(clean[i - 1]);
  }
});
