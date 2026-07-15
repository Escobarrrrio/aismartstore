import { test, expect, Page } from "@playwright/test";

/**
 * Storefront audience split — verifies that residential and business
 * catalogues never cross-contaminate across the four public surfaces:
 *
 *   - Home  (/)         → residential
 *   - Products (/products)  → residential
 *   - Header search    → residential
 *   - Procurement (/procurement) → business
 *
 * We assert via the analytics event stream (window `analytics` CustomEvent
 * dispatched by src/lib/analytics.ts) which is fired from the exact code
 * path that renders each surface. This makes the test independent of the
 * mocked backend response body while still proving the audience parameter
 * routing.
 */

type AnalyticsPayload = {
  name: string;
  audience?: string;
  surface?: string;
  count?: number;
  total?: number;
};

const collectAnalytics = async (page: Page): Promise<AnalyticsPayload[]> => {
  return await page.evaluate(() => (window as any).__analyticsCaptured ?? []);
};

const installAnalyticsCollector = async (page: Page) => {
  await page.addInitScript(() => {
    (window as any).__analyticsCaptured = [];
    window.addEventListener("analytics", (e: any) => {
      (window as any).__analyticsCaptured.push(e.detail);
    });
  });
};

test.describe("Residential vs Business storefront split", () => {
  test.beforeEach(async ({ page }) => {
    await installAnalyticsCollector(page);
  });

  test("Home fires storefront_viewed with audience=residential", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const events = await collectAnalytics(page);
    const viewed = events.filter((e) => e.name === "storefront_viewed");
    expect(viewed.length).toBeGreaterThan(0);
    // Every storefront_viewed on the home page must be residential.
    for (const ev of viewed) {
      expect(ev.audience).toBe("residential");
      expect(ev.surface).toBe("home");
    }
  });

  test("/products fires residential storefront + product_list_returned", async ({ page }) => {
    await page.goto("/products");
    await page.waitForLoadState("networkidle");
    const events = await collectAnalytics(page);
    const viewed = events.find((e) => e.name === "storefront_viewed" && e.surface === "products");
    expect(viewed?.audience, "residential storefront view expected").toBe("residential");

    const returned = events.filter((e) => e.name === "product_list_returned" && e.surface === "products");
    expect(returned.length).toBeGreaterThan(0);
    for (const r of returned) expect(r.audience).toBe("residential");
  });

  test("Header search fires product_list_returned with audience=residential", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Type a common query into the header search input (SEO title/placeholder targets it).
    const search = page.locator('input[type="search"], input[placeholder*="Search"]').first();
    await search.fill("laptop");
    // Wait for the 300ms debounce + RPC.
    await page.waitForTimeout(1200);

    const events = await collectAnalytics(page);
    const returned = events.filter((e) => e.name === "product_list_returned" && e.surface === "header_search");
    expect(returned.length, "header_search should have fired at least once").toBeGreaterThan(0);
    for (const r of returned) expect(r.audience).toBe("residential");
  });

  test("/procurement fires business storefront + product_list_returned", async ({ page }) => {
    await page.goto("/procurement");
    await page.waitForLoadState("networkidle");
    const events = await collectAnalytics(page);

    const viewed = events.find((e) => e.name === "storefront_viewed" && e.surface === "procurement");
    expect(viewed?.audience, "business storefront view expected").toBe("business");

    const returned = events.filter((e) => e.name === "product_list_returned" && e.surface === "procurement");
    expect(returned.length).toBeGreaterThan(0);
    for (const r of returned) expect(r.audience).toBe("business");
  });

  test("Residential surfaces never emit business audience and vice versa", async ({ page }) => {
    // Visit all four surfaces in one session and assert the cross-check.
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.goto("/products");
    await page.waitForLoadState("networkidle");
    await page.goto("/procurement");
    await page.waitForLoadState("networkidle");

    const events = await collectAnalytics(page);
    const residentialSurfaces = new Set(["home", "products", "header_search"]);
    for (const ev of events) {
      if (ev.name !== "storefront_viewed" && ev.name !== "product_list_returned") continue;
      if (residentialSurfaces.has(ev.surface ?? "")) {
        expect(ev.audience, `${ev.surface} must be residential`).toBe("residential");
      } else if (ev.surface === "procurement") {
        expect(ev.audience, "procurement must be business").toBe("business");
      }
    }
  });
});
