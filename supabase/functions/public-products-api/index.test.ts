import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  clampPage,
  clampPageSize,
  parseBool,
  parseNumber,
  toPublicShape,
  VALID_AUDIENCES,
  VALID_SORTS,
} from "./index.ts";

Deno.test("parseBool only accepts the two truthy spellings a query string can carry", () => {
  assertEquals(parseBool("true"), true);
  assertEquals(parseBool("1"), true);
  assertEquals(parseBool("false"), false);
  assertEquals(parseBool("0"), false);
  assertEquals(parseBool("yes"), false);
  assertEquals(parseBool(null), false);
});

Deno.test("parseNumber rejects blank/garbage input instead of coercing it to 0", () => {
  assertEquals(parseNumber("42"), 42);
  assertEquals(parseNumber("19.5"), 19.5);
  assertEquals(parseNumber(""), null);
  assertEquals(parseNumber("   "), null);
  assertEquals(parseNumber(null), null);
  assertEquals(parseNumber("not-a-number"), null);
});

Deno.test("clampPageSize defaults when unset and caps a caller trying to pull the whole catalogue in one page", () => {
  assertEquals(clampPageSize(null), 24);
  assertEquals(clampPageSize(10), 10);
  assertEquals(clampPageSize(500), 50);
  assertEquals(clampPageSize(0), 1);
  assertEquals(clampPageSize(-5), 1);
  assertEquals(clampPageSize(12.9), 12);
});

Deno.test("clampPage floors and rejects negative pages", () => {
  assertEquals(clampPage(null), 0);
  assertEquals(clampPage(3), 3);
  assertEquals(clampPage(-1), 0);
  assertEquals(clampPage(2.9), 2);
});

Deno.test("VALID_SORTS / VALID_AUDIENCES are the exact values the handler checks against", () => {
  assertEquals(VALID_SORTS, ["relevance", "price_asc", "price_desc", "newest"]);
  assertEquals(VALID_AUDIENCES, ["residential", "business", "all"]);
});

Deno.test("toPublicShape never leaks internal columns and always carries a currency + storefront url", () => {
  const row = {
    id: "11111111-1111-1111-1111-111111111111",
    sku: "FR-NB-AB2502-5T2S",
    slug: "asus-expertbook-b2502c",
    name: "ASUS ExpertBook B2502C",
    description: "Core i5, 8GB RAM, 256GB SSD",
    price: 20473.83,
    category: "Notebook",
    brand: "ASUS",
    stock_quantity: 4,
    in_stock: true,
    images: ["https://example.com/a.jpg"],
    is_ai_product: false,
    audience: "residential",
    // Present on real rows (e.g. the manually-sourced Frontosa laptops) --
    // must never survive into the public shape.
    specifications: { supplier: "Frontosa", supplier_sku: "AB2502-5T2S", cost: 15000 },
  };

  const shaped = toPublicShape(row);

  assertEquals(shaped, {
    id: row.id,
    sku: row.sku,
    slug: row.slug,
    name: row.name,
    description: row.description,
    brand: row.brand,
    category: row.category,
    price: row.price,
    currency: "ZAR",
    inStock: true,
    stockQuantity: 4,
    isAiProduct: false,
    audience: "residential",
    images: row.images,
    url: `https://aismartstore.co.za/product/${row.id}`,
  });
  // deno-lint-ignore no-explicit-any
  assertEquals((shaped as any).specifications, undefined);
});

Deno.test("toPublicShape falls back to an empty images array rather than null", () => {
  const row = {
    id: "2", sku: "X", slug: "x", name: "X", description: null, price: 1,
    category: "C", brand: "B", stock_quantity: 0, in_stock: false,
    images: null, is_ai_product: false, audience: "business",
  };
  assertEquals(toPublicShape(row).images, []);
});
