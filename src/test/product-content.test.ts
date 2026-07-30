import { describe, it, expect } from "vitest";
import { generateContent, faqJsonLd } from "@/lib/product-content";
import type { Product } from "@/contexts/CartContext";

const make = (over: Partial<Product> = {}): Product => ({
  id: "p1",
  name: "Dell Pro Webcam - WB5023",
  description: "",
  price: 1405.6,
  category: "Peripherals",
  brand: "Dell",
  sku: "WB5023",
  images: ["https://x/a.jpg"],
  inStock: true,
  stockQuantity: 6,
  isAiProduct: false,
  createdAt: "2026-07-01T00:00:00Z",
  ...over,
});

describe("generateContent", () => {
  it("is deterministic", () => {
    expect(generateContent(make())).toEqual(generateContent(make()));
  });

  it("names the product, brand and country in the opening line", () => {
    const c = generateContent(make());
    expect(c.description).toContain("Dell Pro Webcam - WB5023");
    expect(c.description).toContain("Dell");
    expect(c.description).toContain("South Africa");
  });

  it("picks the right article for a vowel-initial brand", () => {
    expect(generateContent(make({ brand: "Asus" })).description).toContain("an Asus");
    expect(generateContent(make({ brand: "Dell" })).description).toContain("a Dell");
  });

  it("keeps the meta description inside Google's truncation limit", () => {
    for (const name of ["Short", "x".repeat(400)]) {
      const meta = generateContent(make({ name })).metaDescription;
      expect(meta.length).toBeLessThanOrEqual(155);
      expect(meta.length).toBeGreaterThan(0);
    }
  });

  it("omits the price sentence rather than printing R0", () => {
    const c = generateContent(make({ price: 0 }));
    expect(c.description).not.toMatch(/R\s?0\b/);
    expect(c.faqs.some((f) => /how much/i.test(f.question))).toBe(false);
  });

  it("tells the truth about stock in both directions", () => {
    expect(generateContent(make({ inStock: true })).faqs.find((f) => /in stock/i.test(f.question))?.answer)
      .toMatch(/in stock/i);
    const out = generateContent(make({ inStock: false })).faqs.find((f) => /in stock/i.test(f.question))?.answer;
    expect(out).toMatch(/backorder/i);
    // Never claim availability we do not have -- that is a CPA problem, not a
    // copywriting one.
    expect(out).not.toMatch(/\bYes\b/);
  });

  it("never invents a specification", () => {
    // A name with no parseable technical attributes must not produce a spec FAQ.
    const c = generateContent(make({ name: "Generic Thing", brand: "", category: "" }));
    expect(c.faqs.some((f) => /specifications/i.test(f.question))).toBe(false);
    expect(c.description).not.toMatch(/It lists/);
  });

  it("does not repeat the brand from the details spec group", () => {
    // buildSpecifications puts Brand/Category in "Product details"; restating
    // them in the prose reads as padding.
    const c = generateContent(make());
    const listsClause = c.description.match(/It lists ([^.]*)\./)?.[1] ?? "";
    expect(listsClause.toLowerCase()).not.toContain("brand");
    expect(listsClause.toLowerCase()).not.toContain("category");
  });

  it("always answers delivery, because every SA shopper asks it", () => {
    const c = generateContent(make());
    const delivery = c.faqs.find((f) => /deliver/i.test(f.question));
    expect(delivery?.answer).toMatch(/nine provinces/i);
  });

  it("produces highlights that always end with the trust line", () => {
    const h = generateContent(make()).highlights;
    expect(h.length).toBeGreaterThan(2);
    expect(h[h.length - 1]).toMatch(/VAT included/);
  });

  it("survives a product with nothing but a name", () => {
    const bare = generateContent(make({
      brand: undefined, category: "", price: 0, sku: undefined, stockQuantity: undefined,
    }));
    expect(bare.description.length).toBeGreaterThan(10);
    expect(bare.metaDescription.length).toBeGreaterThan(0);
    expect(bare.faqs.length).toBeGreaterThan(0);
  });
});

describe("faqJsonLd", () => {
  it("emits valid FAQPage schema mirroring the visible answers", () => {
    const c = generateContent(make());
    const ld = faqJsonLd(c) as {
      "@type": string;
      mainEntity: { "@type": string; name: string; acceptedAnswer: { text: string } }[];
    };
    expect(ld["@type"]).toBe("FAQPage");
    expect(ld.mainEntity).toHaveLength(c.faqs.length);
    // Schema text must match what the page renders, or Google revokes the rich
    // result for describing content the visitor cannot see.
    ld.mainEntity.forEach((q, i) => {
      expect(q["@type"]).toBe("Question");
      expect(q.name).toBe(c.faqs[i].question);
      expect(q.acceptedAnswer.text).toBe(c.faqs[i].answer);
    });
  });
});
