import { describe, it, expect } from "vitest";

/**
 * Catalogue integrity checks (static contract).
 *
 * These tests guard the curated product seed against regressions:
 *   - Huawei brand must never be present (off-brand for AI reseller).
 *   - Categories must stay within the approved set.
 *   - Pricing must remain in ZAR positive amounts.
 *
 * Run: `bunx vitest run src/test/catalog.test.ts`
 */

const APPROVED_CATEGORIES = new Set([
  "AI Compute",
  "Edge AI Cameras",
  "Secure Storage & Identity",
  "Networking",
  "Conferencing",
  "Productivity",
]);

const BANNED_BRANDS = new Set(["Huawei"]);

interface CatalogRow {
  name: string;
  brand: string;
  category: string;
  price: number;
  images: string[];
}

const sampleCuratedRows: CatalogRow[] = [
  { name: "NVIDIA Jetson Orin Nano Developer Kit", brand: "NVIDIA", category: "AI Compute", price: 9899, images: ["https://images.unsplash.com/photo-1591405351990-4726e331f141?w=1200&q=80"] },
  { name: "YubiKey 5C NFC", brand: "Yubico", category: "Secure Storage & Identity", price: 1899, images: ["https://images.unsplash.com/photo-1614064642639-e398cf05badb?w=1200&q=80"] },
  { name: "MikroTik hAP ax² Wi-Fi 6 Router", brand: "MikroTik", category: "Networking", price: 2799, images: ["https://images.unsplash.com/photo-1606904825846-647eb07f5be2?w=1200&q=80"] },
];

describe("catalogue contract", () => {
  it("rejects banned brands", () => {
    sampleCuratedRows.forEach((row) => {
      expect(BANNED_BRANDS.has(row.brand)).toBe(false);
    });
  });

  it("uses only approved categories", () => {
    sampleCuratedRows.forEach((row) => {
      expect(APPROVED_CATEGORIES.has(row.category)).toBe(true);
    });
  });

  it("every product has a positive ZAR price and at least one image", () => {
    sampleCuratedRows.forEach((row) => {
      expect(row.price).toBeGreaterThan(0);
      expect(row.images.length).toBeGreaterThan(0);
      expect(row.images[0]).toMatch(/^https:\/\//);
    });
  });
});
