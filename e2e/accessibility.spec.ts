import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Automated accessibility check.
 * Fails the CI build when axe-core detects a color-contrast violation
 * (WCAG 2.1 AA — 1.4.3) on any public route. Extend `routes` as new
 * top-level pages ship.
 */
const routes = [
  { name: "home", path: "/" },
  { name: "products", path: "/products" },
  { name: "procurement", path: "/procurement" },
  { name: "ai-pulse", path: "/ai-pulse" },
  { name: "compliance", path: "/compliance" },
  { name: "auth", path: "/auth" },
];

for (const route of routes) {
  test(`${route.name} has no color-contrast violations`, async ({ page }) => {
    await page.goto(route.path, { waitUntil: "networkidle" });

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2aa", "wcag21aa"])
      .options({ runOnly: { type: "rule", values: ["color-contrast"] } })
      .analyze();

    if (results.violations.length > 0) {
      console.log(
        `Contrast violations on ${route.path}:`,
        JSON.stringify(
          results.violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
          })),
          null,
          2,
        ),
      );
    }
    expect(results.violations, "color-contrast violations").toEqual([]);
  });
}
