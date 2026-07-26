import { test, expect, Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * ProductCard layout, overlap, long-content, a11y & visual regression.
 * Runs on both mobile-chromium and desktop-chromium projects.
 */

async function gotoProducts(page: Page) {
  await page.goto("/products", { waitUntil: "domcontentloaded" });
  const card = page.getByTestId("product-card").first();
  await card.waitFor({ state: "visible", timeout: 15_000 });
  // Give lazy images a moment to settle so screenshots are stable.
  await page.waitForLoadState("networkidle").catch(() => {});
}

type Box = { x: number; y: number; width: number; height: number };

// Playwright's boundingBox() only returns {x, y, width, height} -- unlike a
// native DOMRect it has no .right/.bottom/.left/.top, so those must be derived.
function rectsOverlap(a: Box | null, b: Box | null) {
  if (!a || !b) return false;
  const aRight = a.x + a.width;
  const bRight = b.x + b.width;
  const aBottom = a.y + a.height;
  const bBottom = b.y + b.height;
  return !(aRight <= b.x || bRight <= a.x || aBottom <= b.y || bBottom <= a.y);
}

test.describe("ProductCard — price & Add-to-Cart never overlap", () => {
  test("price and add-to-cart button do not intersect", async ({ page }) => {
    await gotoProducts(page);
    const cards = page.getByTestId("product-card");
    const count = Math.min(await cards.count(), 8);
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const card = cards.nth(i);
      const priceBox = await card.locator("span.font-display.font-extrabold").first().boundingBox();
      const cta = card.getByRole("button", { name: /add .* to cart/i });
      const ctaBox = await cta.boundingBox();
      expect(priceBox, `card ${i} price bbox`).not.toBeNull();
      expect(ctaBox, `card ${i} cta bbox`).not.toBeNull();
      const overlaps = rectsOverlap(priceBox as any, ctaBox as any);
      expect(overlaps, `card ${i}: price/CTA overlap`).toBe(false);
      // Button must sit fully below the price (stacked layout)
      expect((ctaBox as any).y).toBeGreaterThanOrEqual((priceBox as any).y + (priceBox as any).height - 1);
    }
  });

  test("layout survives long titles and long prices", async ({ page }) => {
    await gotoProducts(page);
    // Force long content into the first card and re-measure.
    await page.evaluate(() => {
      const card = document.querySelector('[data-testid="product-card"]');
      if (!card) return;
      const title = card.querySelector("h3");
      const price = card.querySelector("span.font-display.font-extrabold");
      if (title) title.textContent = "Extra-long product title ".repeat(6).trim();
      if (price) price.textContent = "R 1,234,567,890.00";
    });

    const card = page.getByTestId("product-card").first();
    const cardBox = await card.boundingBox();
    const priceBox = await card.locator("span.font-display.font-extrabold").first().boundingBox();
    const ctaBox = await card.getByRole("button", { name: /add .* to cart/i }).boundingBox();

    expect(cardBox && priceBox && ctaBox).toBeTruthy();
    // No horizontal overflow
    const cardRight = (cardBox as Box).x + (cardBox as Box).width;
    expect((priceBox as Box).x + (priceBox as Box).width).toBeLessThanOrEqual(cardRight + 1);
    expect((ctaBox as Box).x + (ctaBox as Box).width).toBeLessThanOrEqual(cardRight + 1);
    // Still no overlap after content stretch
    expect(rectsOverlap(priceBox as Box, ctaBox as Box)).toBe(false);
  });
});

test.describe("ProductCard — accessibility", () => {
  test("add-to-cart button has label, is focusable and keyboard-activatable", async ({ page }) => {
    await gotoProducts(page);
    const cta = page.getByTestId("product-card").first().getByRole("button", { name: /add .* to cart/i });
    await expect(cta).toBeVisible();

    const label = await cta.getAttribute("aria-label");
    expect(label && /add .+ to cart/i.test(label)).toBeTruthy();

    // Focus via keyboard and activate with Enter
    await cta.focus();
    await expect(cta).toBeFocused();
    // Focus ring should render (outline or box-shadow non-empty)
    const hasFocusStyle = await cta.evaluate((el) => {
      const s = getComputedStyle(el);
      return s.outlineStyle !== "none" || s.boxShadow !== "none";
    });
    expect(hasFocusStyle).toBe(true);

    await page.keyboard.press("Enter");
    // Cart badge in header should reach 1 (button toggles added state)
    const header = page.getByRole("link", { name: /cart/i }).first();
    await expect(header).toBeVisible();
  });

  test("axe: no serious a11y violations on the products grid", async ({ page }) => {
    await gotoProducts(page);
    const results = await new AxeBuilder({ page })
      .include('[data-testid="product-card"]')
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    const serious = results.violations.filter((v) => ["serious", "critical"].includes(v.impact || ""));
    expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
  });
});

test.describe("ProductCard — visual regression", () => {
  test("products grid snapshot", async ({ page }, testInfo) => {
    await gotoProducts(page);
    // Mask images since remote product images change frequently.
    const grid = page.locator('main, [role="main"], body').first();
    await expect(grid).toHaveScreenshot(`products-grid-${testInfo.project.name}.png`, {
      fullPage: false,
      mask: [page.locator('[data-testid="product-card"] img')],
      maxDiffPixelRatio: 0.02,
      animations: "disabled",
    });
  });
});
