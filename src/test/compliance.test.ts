import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * POPIA & PAIA compliance is a legal claim we make publicly. These tests
 * fail loudly if a future refactor accidentally deletes the compliance
 * page, the footer link, or the Information Officer contact — any of
 * which would put us in breach.
 */
describe("POPIA & PAIA compliance surface", () => {
  const compliancePage = join(process.cwd(), "src/pages/Compliance.tsx");
  const footer = join(process.cwd(), "src/components/StoreFooter.tsx");
  const app = join(process.cwd(), "src/App.tsx");
  const doc = join(process.cwd(), "docs/POPIA-PAIA.md");

  it("has a public /compliance page", () => {
    expect(existsSync(compliancePage)).toBe(true);
    const src = readFileSync(compliancePage, "utf8");
    expect(src).toMatch(/POPIA/);
    expect(src).toMatch(/PAIA/);
    expect(src).toMatch(/Information Officer/i);
    expect(src).toMatch(/fsteyn@rocketmail\.com/);
  });

  it("routes /compliance from the app shell", () => {
    const src = readFileSync(app, "utf8");
    expect(src).toMatch(/path="\/compliance"/);
  });

  it("links to compliance from the footer", () => {
    const src = readFileSync(footer, "utf8");
    expect(src).toMatch(/\/compliance/);
    expect(src).toMatch(/POPIA/);
  });

  it("keeps the operational POPIA/PAIA doc in the repo", () => {
    expect(existsSync(doc)).toBe(true);
    const src = readFileSync(doc, "utf8");
    expect(src).toMatch(/Information Officer/);
    expect(src).toMatch(/Regulator/);
  });
});
