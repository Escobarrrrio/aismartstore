import { test, expect } from "@playwright/test";

/**
 * Mobile performance guardrail for /products.
 *
 * Verifies:
 *  1. Cumulative Layout Shift (CLS) during a full-page scroll stays under
 *     the "good" Web Vitals threshold (< 0.1). Incremental rendering
 *     (pagination + fixed-aspect image containers) must not push cards
 *     around as images load.
 *  2. Product images use lazy loading (`loading="lazy"`) so off-screen
 *     images don't compete for bandwidth on mobile.
 *  3. Every product-card image container reserves space (aspect-square)
 *     so the layout never reflows when images arrive.
 *
 * Runs only on the mobile project.
 */

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "mobile-chromium", "Mobile performance guardrail");
});

test("scrolling /products stays smooth (CLS < 0.1) and images are lazy", async ({ page }) => {
  // Install a PerformanceObserver BEFORE the app scripts run so we capture
  // every layout-shift entry from first paint onward.
  await page.addInitScript(() => {
    (window as any).__cls = 0;
    try {
      const po = new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as any[]) {
          // Ignore shifts caused by recent user input (per Web Vitals spec).
          if (!entry.hadRecentInput) (window as any).__cls += entry.value || 0;
        }
      });
      po.observe({ type: "layout-shift", buffered: true });
    } catch {
      // layout-shift not supported (very old browsers) — treat as 0.
    }
  });

  await page.goto("/products");
  // Wait until results have hydrated so the first paint is stable.
  await expect(page.locator('[data-testid="results-count"]')).toHaveAttribute(
    "data-loading",
    "false",
    { timeout: 15_000 },
  );
  await expect(page.locator('[data-testid="product-card"]').first()).toBeVisible({
    timeout: 15_000,
  });

  // Every card must have exactly one lazy-loaded image with reserved space.
  const cardImgs = page.locator('[data-testid="product-card"] img');
  const count = await cardImgs.count();
  expect(count).toBeGreaterThan(0);

  const loadingAttrs = await cardImgs.evaluateAll((els) =>
    els.map((e) => (e as HTMLImageElement).loading),
  );
  const eagerCount = loadingAttrs.filter((l) => l !== "lazy").length;
  // Every card image should be lazy on mobile.
  expect(eagerCount, `expected all card images lazy, found ${eagerCount} eager`).toBe(0);

  // The <img> wrapper must reserve a square aspect so images arriving late
  // never shift the grid.
  const wrappersHaveAspect = await page
    .locator('[data-testid="product-card"] a[href^="/product/"]')
    .evaluateAll((els) => els.every((e) => (e as HTMLElement).className.includes("aspect-square")));
  expect(wrappersHaveAspect).toBe(true);

  // Simulate a real mobile scroll pass down the page in ~200px chunks so
  // any lazy-image insertion has a chance to shift layout.
  const scrollHeight = await page.evaluate(() => document.body.scrollHeight);
  const viewport = page.viewportSize()!.height;
  const steps = Math.min(30, Math.ceil(scrollHeight / 200));
  for (let i = 0; i < steps; i++) {
    await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" as ScrollBehavior }), (i + 1) * 200);
    await page.waitForTimeout(60);
  }
  // Scroll back up too — bfcache & sticky recalculation shouldn't shift.
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior }));
  await page.waitForTimeout(200);

  const cls = await page.evaluate(() => (window as any).__cls as number);
  // Web Vitals "good" threshold is 0.1. Fail hard above it.
  expect(cls, `CLS ${cls} exceeded the 0.1 mobile threshold`).toBeLessThan(0.1);
  expect(viewport).toBeGreaterThan(0);
});
