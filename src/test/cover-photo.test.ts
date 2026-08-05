import { describe, it, expect } from "vitest";
import { promoteToCover, removePhoto, hasUsableCover } from "@/lib/coverPhoto";

const IMGS = ["a.jpg", "b.jpg", "c.jpg", "d.jpg"];

describe("promoteToCover", () => {
  it("moves the chosen photo to the front", () => {
    expect(promoteToCover(IMGS, 2)).toEqual(["c.jpg", "a.jpg", "b.jpg", "d.jpg"]);
  });

  it("keeps every other photo in its existing relative order", () => {
    // The photos behind the cover are still an order the owner arranged.
    // Promoting one must not shuffle the rest.
    const next = promoteToCover(IMGS, 3);
    expect(next).toEqual(["d.jpg", "a.jpg", "b.jpg", "c.jpg"]);
    expect(next.slice(1)).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
  });

  it("loses no photos and duplicates none", () => {
    const next = promoteToCover(IMGS, 2);
    expect(next).toHaveLength(IMGS.length);
    expect(new Set(next)).toEqual(new Set(IMGS));
  });

  it("returns the SAME array when the photo is already the cover", () => {
    // Identity, not just equality: the caller uses `next !== images` to skip a
    // pointless write to the products table.
    expect(promoteToCover(IMGS, 0)).toBe(IMGS);
  });

  it("returns the same array for an out-of-range index rather than corrupting", () => {
    expect(promoteToCover(IMGS, 99)).toBe(IMGS);
    expect(promoteToCover(IMGS, -1)).toBe(IMGS);
  });

  it("handles a single-photo product", () => {
    expect(promoteToCover(["only.jpg"], 0)).toEqual(["only.jpg"]);
  });

  it("does not mutate the input", () => {
    const original = [...IMGS];
    promoteToCover(IMGS, 2);
    expect(IMGS).toEqual(original);
  });
});

describe("removePhoto", () => {
  it("removes the photo at the index", () => {
    expect(removePhoto(IMGS, 1)).toEqual(["a.jpg", "c.jpg", "d.jpg"]);
  });

  it("promotes the next photo when the cover is deleted", () => {
    expect(removePhoto(IMGS, 0)[0]).toBe("b.jpg");
  });

  it("deleting the only photo yields an empty array, not a crash", () => {
    expect(removePhoto(["only.jpg"], 0)).toEqual([]);
  });

  it("ignores an out-of-range index", () => {
    expect(removePhoto(IMGS, 99)).toBe(IMGS);
  });

  it("does not mutate the input", () => {
    const original = [...IMGS];
    removePhoto(IMGS, 1);
    expect(IMGS).toEqual(original);
  });
});

describe("hasUsableCover", () => {
  it("is true for a real photo", () => {
    expect(hasUsableCover(["https://cdn/a.jpg"])).toBe(true);
  });

  it("is false for null, undefined and empty", () => {
    expect(hasUsableCover(null)).toBe(false);
    expect(hasUsableCover(undefined)).toBe(false);
    expect(hasUsableCover([])).toBe(false);
  });

  it("is false for a blank string masquerading as a photo", () => {
    // A whitespace URL renders as a broken image, which looks worse than no
    // image at all, and it would otherwise pass a naive length check.
    expect(hasUsableCover(["   "])).toBe(false);
    expect(hasUsableCover([""])).toBe(false);
  });
});
