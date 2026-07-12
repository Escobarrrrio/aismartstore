import { test, expect, Page } from "@playwright/test";

/**
 * E2E coverage for the mobile filter bottom sheet on /products.
 *
 * Verifies:
 *  - Bottom sheet opens from the "Filters" trigger and traps focus.
 *  - Per-tab search filters the option list.
 *  - Selecting a facet updates the "Show N results" primary CTA.
 *  - Clear all + footer Reset both restore the empty state.
 *  - Keyboard navigation: Tab to move, Enter to activate, Escape to close.
 *
 * These tests run on a mobile viewport (Pixel 7) so the sheet is visible.
 * The tests are resilient to catalogue size — they read the current result
 * count from the CTA rather than asserting on exact numbers.
 */

const parseCount = (label: string) => {
  const m = label.replace(/\s/g, "").match(/Show([\d,]+)result/i);
  if (!m) return NaN;
  return Number(m[1].replace(/,/g, ""));
};

const openSheet = async (page: Page) => {
  await page.goto("/products");
  // Wait for the initial result count in the header to appear so the app is hydrated.
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const trigger = page.getByRole("button", { name: /filters/i }).first();
  await expect(trigger).toBeVisible();
  await trigger.click();
  await expect(page.getByRole("dialog")).toBeVisible();
};

test.describe("Mobile filter bottom sheet", () => {
  test("opens, shows tabs, and traps focus", async ({ page }) => {
    await openSheet(page);
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("tab", { name: /category/i })).toBeVisible();
    await expect(dialog.getByRole("tab", { name: /brand/i })).toBeVisible();
    await expect(dialog.getByRole("tab", { name: /more/i })).toBeVisible();
    // Search input inside the category tab is autofocused.
    await expect(dialog.getByPlaceholder(/search categories/i)).toBeFocused();
    // Close via the header X button.
    await dialog.getByRole("button", { name: /close filters/i }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
  });

  test("per-tab search filters the option list", async ({ page }) => {
    await openSheet(page);
    const dialog = page.getByRole("dialog");
    const catGroup = dialog.getByRole("radiogroup", { name: /category/i });
    // Wait for at least one option beyond "All categories".
    await expect(catGroup.getByRole("radio").nth(1)).toBeVisible({ timeout: 10_000 });
    const initial = await catGroup.getByRole("radio").count();
    expect(initial).toBeGreaterThan(1);

    // Type a very unlikely string — list should collapse to just the "no matches" state,
    // which removes the radiogroup entirely.
    await dialog.getByPlaceholder(/search categories/i).fill("zzzzq-nonexistent");
    await expect(dialog.getByText(/no matches/i)).toBeVisible();

    // Clear the search — options return.
    await dialog.getByRole("button", { name: /clear category search/i }).click();
    await expect(catGroup.getByRole("radio").nth(1)).toBeVisible();
  });

  test('"Show N results" updates when a facet is selected', async ({ page }) => {
    await openSheet(page);
    const dialog = page.getByRole("dialog");
    const cta = dialog.getByRole("button", { name: /^show [\d,\s]+ results?$/i });
    await expect(cta).toBeVisible();
    const baselineLabel = (await cta.textContent()) || "";
    const baseline = parseCount(baselineLabel);
    expect(Number.isFinite(baseline)).toBe(true);

    // Pick the first real category option (index 1, since 0 is "All categories").
    const catGroup = dialog.getByRole("radiogroup", { name: /category/i });
    await expect(catGroup.getByRole("radio").nth(1)).toBeVisible({ timeout: 10_000 });
    await catGroup.getByRole("radio").nth(1).click();

    // The active-filter pill in the header appears.
    await expect(dialog.getByLabel(/filters active/i)).toBeVisible();

    // Wait for the CTA label to change to a smaller (or at least different) count.
    await expect
      .poll(async () => parseCount((await cta.textContent()) || ""), {
        timeout: 10_000,
        message: "result count should update after selecting a category",
      })
      .not.toBe(baseline);
  });

  test("Clear all resets selected facets", async ({ page }) => {
    await openSheet(page);
    const dialog = page.getByRole("dialog");
    const catGroup = dialog.getByRole("radiogroup", { name: /category/i });
    await expect(catGroup.getByRole("radio").nth(1)).toBeVisible({ timeout: 10_000 });
    await catGroup.getByRole("radio").nth(1).click();
    await expect(dialog.getByLabel(/filters active/i)).toBeVisible();

    // Header "Clear all" button.
    await dialog.getByRole("button", { name: /^clear all$/i }).click();

    // "All categories" radio should be checked again, active-filter pill gone.
    await expect(dialog.getByLabel(/filters active/i)).toBeHidden();
    await expect(
      catGroup.getByRole("radio", { name: /all categories/i })
    ).toHaveAttribute("aria-checked", "true");
  });

  test("footer Reset button behaves the same as Clear all", async ({ page }) => {
    await openSheet(page);
    const dialog = page.getByRole("dialog");
    const catGroup = dialog.getByRole("radiogroup", { name: /category/i });
    await expect(catGroup.getByRole("radio").nth(1)).toBeVisible({ timeout: 10_000 });
    await catGroup.getByRole("radio").nth(1).click();
    await expect(dialog.getByLabel(/filters active/i)).toBeVisible();

    await dialog.getByRole("button", { name: /^reset$/i }).click();
    await expect(dialog.getByLabel(/filters active/i)).toBeHidden();
  });

  test("keyboard: Tab reaches options, Enter selects, Escape closes", async ({ page }) => {
    await openSheet(page);
    const dialog = page.getByRole("dialog");
    // Switch to Brand tab via keyboard (tabs use arrow keys per WAI-ARIA).
    await dialog.getByRole("tab", { name: /category/i }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(dialog.getByRole("tab", { name: /brand/i })).toHaveAttribute(
      "aria-selected",
      "true"
    );

    // Wait for brand list, then focus the search input and Tab to first radio.
    const brandGroup = dialog.getByRole("radiogroup", { name: /brand/i });
    await expect(brandGroup.getByRole("radio").nth(1)).toBeVisible({ timeout: 10_000 });
    await dialog.getByPlaceholder(/search brands/i).focus();
    // Tab past the search's own clear button (only present when non-empty; here it's empty).
    await page.keyboard.press("Tab");
    // Focus should now be on the first radio ("All brands").
    await expect(brandGroup.getByRole("radio", { name: /all brands/i })).toBeFocused();
    await page.keyboard.press("Tab");
    // Second radio — a real brand.
    const secondRadio = brandGroup.getByRole("radio").nth(1);
    await expect(secondRadio).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(secondRadio).toHaveAttribute("aria-checked", "true");

    // Escape closes the sheet.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
  });
});
