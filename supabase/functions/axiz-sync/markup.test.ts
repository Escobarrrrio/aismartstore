import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { markupFor, sellingPriceFor, DEFAULT_MARKUP_PCT } from "./markup.ts";

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
  // Axiz category strings arrive with inconsistent casing and the odd trailing
  // space; a rule must not miss because of it.
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
  // "Laptop Bags" priced at the laptop margin would quietly halve the margin
  // on an entire accessory line.
  assertEquals(markupFor("Laptop Bags", RULES), 17);
  assertEquals(markupFor("Gaming Laptops", RULES), 17);
});

Deno.test("markupFor: built-in default when no fallback rule exists", () => {
  assertEquals(markupFor("Anything", [{ category: "Laptops", percent: 8 }]), DEFAULT_MARKUP_PCT);
  assertEquals(markupFor("Anything", []), DEFAULT_MARKUP_PCT);
});

Deno.test("markupFor: a non-finite percent is ignored, not applied", () => {
  // NaN would price the product at NaN, which serialises to null and publishes
  // a product with no price at all.
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

Deno.test("the real-world case this exists for", () => {
  // A R200 cable at the old flat 17% earned R34, which a card fee and a
  // courier bag consume. At 45% it earns R90.
  assertEquals(sellingPriceFor(200, 17), 234);
  assertEquals(sellingPriceFor(200, 45), 290);
  // A R30,000 workstation at 17% asks R35,100 in a market that pays single
  // digits over cost. At 8% it asks R32,400.
  assertEquals(sellingPriceFor(30000, 17), 35100);
  assertEquals(sellingPriceFor(30000, 8), 32400);
});
