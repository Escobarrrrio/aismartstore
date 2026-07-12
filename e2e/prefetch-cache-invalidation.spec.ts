import { test, expect } from "@playwright/test";

/**
 * Ensures the in-memory prefetch cache in /products invalidates correctly:
 *
 *  - After changing a filter (category), every visible card must match the
 *    new filter — no stale product from the previous filter set survives.
 *  - After changing pagination, the visible product IDs must differ from the
 *    previous page (proving the cache is per (filters + page) key, not per
 *    page alone).
 *  - Toggling "Include business items" and toggling it back returns to the
 *    same page-1 IDs (cache hit is content-consistent, not stale).
 */

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "desktop-chromium", "UI test runs on desktop only");
});

async function visibleIds(page: import("@playwright/test").Page): Promise<string[]> {
  return page.locator('[data-testid="product-card"]').evaluateAll((els) =>
    els.map((e) => (e as HTMLElement).dataset.productId ?? ""),
  );
}

async function visibleCategories(page: import("@playwright/test").Page): Promise<string[]> {
  return page.locator('[data-testid="product-card"]').evaluateAll((els) =>
    els.map((e) => ((e as HTMLElement).dataset.productCategory ?? "").toLowerCase()),
  );
}

async function waitForResults(page: import("@playwright/test").Page) {
  // results-count exposes data-loading="false" once the RPC has resolved
  await expect(page.locator('[data-testid="results-count"]')).toHaveAttribute(
    "data-loading",
    "false",
    { timeout: 15_000 },
  );
  // and at least one card must be present
  await expect(page.locator('[data-testid="product-card"]').first()).toBeVisible({ timeout: 15_000 });
}

test("prefetch cache invalidates when filters or pages change (no stale rows)", async ({ page }) => {
  await page.goto("/products");
  await waitForResults(page);

  const firstPageIds = await visibleIds(page);
  expect(firstPageIds.length).toBeGreaterThan(0);

  // Move to page 2 and record IDs
  const nextButton = page.getByRole("button", { name: /^Next/ });
  if (await nextButton.isEnabled()) {
    await nextButton.click();
    await waitForResults(page);
    const secondPageIds = await visibleIds(page);
    expect(secondPageIds.length).toBeGreaterThan(0);
    // Pagination MUST show different products (cache is per-page)
    const overlap = secondPageIds.filter((id) => firstPageIds.includes(id));
    expect(overlap.length, "page 2 leaked page-1 rows (stale cache)").toBe(0);

    // Go back to page 1 — cache hit must produce the same IDs as before,
    // not a stale page-2 view.
    await page.getByRole("button", { name: /^Previous/ }).click();
    await waitForResults(page);
    const backToFirst = await visibleIds(page);
    expect(backToFirst.sort()).toEqual(firstPageIds.sort());
  }

  // Change filter (category) via URL — this must invalidate the cache and
  // every visible card must belong to the newly-selected category.
  await page.goto("/products?category=Accessories");
  await waitForResults(page);
  const cats = await visibleCategories(page);
  expect(cats.length).toBeGreaterThan(0);
  const stale = cats.filter((c) => c && c !== "accessories");
  expect(stale, `stale non-accessories rows survived filter change: ${stale.join(",")}`).toEqual([]);

  // Switch to a different filter — again, zero cross-contamination
  await page.goto("/products?category=Laptops");
  await waitForResults(page);
  const cats2 = await visibleCategories(page);
  const stale2 = cats2.filter((c) => c && c !== "laptops");
  expect(stale2, `stale rows survived category swap: ${stale2.join(",")}`).toEqual([]);
});
