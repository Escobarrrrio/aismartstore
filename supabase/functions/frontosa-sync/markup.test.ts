import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { markupFor, sellingPriceFor, DEFAULT_MARKUP_PCT } from "./markup.ts";

// Same test suite as axiz-sync/markup.test.ts -- this file is a deliberate
// duplicate of that one (see the comment in markup.ts), so its tests are
// duplicated too, guarding the copy actually deployed for Frontosa.

const RULES = [
  { category: null, percent: 17 },
  { category: "Laptops", percent: 8 },
  { category: "Cables & Adapters", percent: 45 },
];

Deno.test("markupFor: uses the category's own rule", () => {
  assertEquals(markupFor("Laptops", RULES), 8);
  assertEquals(markupFor("Cables & Adapters", RULES), 45);
});

Deno.test("markupFor: case and surrounding whitespace do not matter", () => {
  assertEquals(markupFor("  laptops ", RULES), 8);
  assertEquals(markupFor("CABLES & ADAPTERS", RULES), 45);
});

Deno.test("markupFor: falls back for anything without a rule", () => {
  assertEquals(markupFor("Smart Home", RULES), 17);
  assertEquals(markupFor(null, RULES), 17);
  assertEquals(markupFor(undefined, RULES), 17);
  assertEquals(markupFor("", RULES), 17);
});

Deno.test("markupFor: matches exactly, never fuzzily", () => {
  assertEquals(markupFor("Laptop Bags", RULES), 17);
  assertEquals(markupFor("Gaming Laptops", RULES), 17);
});

Deno.test("markupFor: built-in default when no fallback rule exists", () => {
  assertEquals(markupFor("Anything", [{ category: "Laptops", percent: 8 }]), DEFAULT_MARKUP_PCT);
  assertEquals(markupFor("Anything", []), DEFAULT_MARKUP_PCT);
});

Deno.test("markupFor: a non-finite percent is ignored, not applied", () => {
  assertEquals(markupFor("Laptops", [{ category: "Laptops", percent: NaN }, { category: null, percent: 17 }]), 17);
  assertEquals(markupFor("Laptops", [{ category: "Laptops", percent: NaN }]), DEFAULT_MARKUP_PCT);
});

Deno.test("sellingPriceFor: applies the markup and rounds to cents", () => {
  assertEquals(sellingPriceFor(1000, 17), 1170);
  assertEquals(sellingPriceFor(999.99, 17), 1169.99);
  assertEquals(sellingPriceFor(29.99, 45), 43.49);
});

Deno.test("sellingPriceFor: zero markup sells at cost", () => {
  assertEquals(sellingPriceFor(1000, 0), 1000);
});
