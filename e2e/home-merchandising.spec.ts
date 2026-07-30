import { test, expect, Page } from "@playwright/test";

/**
 * The home page is the shop window. This asserts what a residential visitor
 * actually sees there -- not that a query ran, but that the products on screen
 * are ones a household would buy.
 *
 * The regression this guards against is the original bug: the page ordered by
 * `created_at DESC` against a residential pool that is 57% cables and generic
 * accessories, so it rendered rack rails, C13 power cords, QSFP transceivers
 * and 3-year care packs. Those terms are now impossible by construction (see
 * `merch_is_home_eligible` and the demand floors), and this spec keeps them
 * impossible from the outside.
 */

/** Titles that must never appear in a household shop window. */
const FORBIDDEN = [
  /\brack\b/i,
  /\brail\b/i,
  /transceiver|xcvr|qsfp|\bsfp\b/i,
  /care pack|foundation care|warranty/i,
  /power cord|patch (cord|panel)/i,
  /proliant|\bdl\d{3}\b|\bml\d{2,3}\b|gen1[01]/i,
  /nlsas|\bsas\b|backplane|riser/i,
  /licen[cs]e|\be-?ltu\b/i,
];

const cardTitles = async (page: Page, section: string): Promise<string[]> => {
  const cards = page.locator(`${section} [data-testid="product-card"]`);
  await expect(cards.first()).toBeVisible({ timeout: 15_000 });
  return (await cards.locator("h3").allTextContents()).map((t) => t.trim()).filter(Boolean);
};

test.describe("residential home page merchandising", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("shows only products a household would actually shop for", async ({ page }) => {
    const titles = await cardTitles(page, "body");
    expect(titles.length, "the home page rendered no product cards at all").toBeGreaterThan(0);

    for (const title of titles) {
      for (const pattern of FORBIDDEN) {
        expect(
          title,
          `"${title}" is enterprise/datacentre stock and must not reach the residential home page`,
        ).not.toMatch(pattern);
      }
    }
  });

  test("prices every home-page product inside the residential band", async ({ page }) => {
    const cards = page.locator('[data-testid="product-card"]');
    await expect(cards.first()).toBeVisible({ timeout: 15_000 });

    // Read the raw ZAR figure off the card rather than parsing the rendered
    // price: the storefront formats through formatPrice across 13 locales and
    // a currency switcher, so "R1 129,05" is only one of several renderings.
    const prices = await cards.evaluateAll((nodes) =>
      nodes.map((n) => Number(n.getAttribute("data-product-price"))),
    );
    expect(prices.length).toBeGreaterThan(0);

    for (const value of prices) {
      expect(Number.isFinite(value), "a product card carries no readable price").toBe(true);
      expect(value, `R${value} is above the R15 000 residential ceiling`).toBeLessThanOrEqual(15_000);
      expect(value, "a product card is priced at zero").toBeGreaterThan(0);
    }
  });

  test("does not repeat the same product across the two grids", async ({ page }) => {
    const ids = await page
      .locator('[data-testid="product-card"]')
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-product-id") ?? ""));
    const present = ids.filter(Boolean);
    expect(present.length).toBeGreaterThan(0);
    expect(new Set(present).size, "a product appears in more than one home-page grid")
      .toBe(present.length);
  });

  test("does not fill a grid with a single brand", async ({ page }) => {
    const titles = await cardTitles(page, "body");
    test.skip(titles.length < 6, "too few products on the page for a diversity assertion");

    // Brand is the first word of the supplier title in this catalogue.
    const firstWords = titles.map((t) => t.split(/\s+/)[0].toLowerCase());
    const counts = new Map<string, number>();
    for (const w of firstWords) counts.set(w, (counts.get(w) ?? 0) + 1);
    const dominant = Math.max(...counts.values());

    // The per-brand cap is 2 per slot across 2 slots. Allow headroom for the
    // fallback path and for brands that share a leading word.
    expect(dominant, "the home page is dominated by one brand")
      .toBeLessThanOrEqual(Math.max(5, Math.ceil(titles.length * 0.6)));
  });
});
