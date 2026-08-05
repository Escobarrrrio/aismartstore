import { describe, it, expect } from "vitest";
import {
  sourceOf, realisedMarginPct, appliedMarkupPct, daysSince,
  priceFindings, worstSeverity, markupFor, sellingPriceFor,
  DEFAULT_MARKUP_PCT, type SourcedProduct,
} from "@/lib/sourcing";

const NOW = new Date("2026-08-05T12:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

const product = (over: Partial<SourcedProduct> = {}): SourcedProduct => ({
  id: "p1",
  name: "Thing",
  category: "Smart Home",
  price: 1170,
  last_synced_at: ago(0),
  specifications: null,
  cost: { cost_price: 1000, selling_price: 1170, margin_percentage: 17, axiz_product_id: "AX-1", updated_at: ago(0) },
  ...over,
});

describe("sourceOf", () => {
  it("recognises a distributor product by its feed id", () => {
    expect(sourceOf(product())).toBe("distributor");
  });

  it("recognises a hand-sourced product by its tag", () => {
    expect(sourceOf(product({ cost: null, specifications: { manually_sourced: true } }))).toBe("manual");
  });

  it("recognises a hand-sourced product by a recorded supplier", () => {
    expect(sourceOf(product({ cost: null, specifications: { supplier: "GeeWiz" } }))).toBe("manual");
  });

  it("says unknown rather than guessing", () => {
    // "We do not know where this price came from" is the finding, not a gap to
    // paper over with a plausible default.
    expect(sourceOf(product({ cost: null, specifications: {} }))).toBe("unknown");
    expect(sourceOf(product({ cost: null, specifications: null }))).toBe("unknown");
  });
});

describe("margin vs markup", () => {
  it("reports realised margin, not markup", () => {
    // The trap this exists to catch: cost 1000 marked up 17% sells at 1170,
    // but the margin actually realised is 14.5%, not 17%.
    expect(realisedMarginPct(1000, 1170)).toBeCloseTo(14.53, 1);
    expect(appliedMarkupPct(1000, 1170)).toBeCloseTo(17, 5);
  });

  it("returns null rather than 0 when it cannot be computed", () => {
    // "No cost recorded" and "sold at cost" must not collapse into one figure.
    expect(realisedMarginPct(null, 1170)).toBeNull();
    expect(realisedMarginPct(1000, null)).toBeNull();
    expect(realisedMarginPct(1000, 0)).toBeNull();
    expect(appliedMarkupPct(0, 1170)).toBeNull();
  });

  it("handles a negative margin when selling below cost", () => {
    expect(realisedMarginPct(1000, 900)).toBeCloseTo(-11.11, 1);
  });
});

describe("daysSince", () => {
  it("counts whole days", () => {
    expect(daysSince(ago(3), NOW)).toBe(3);
    expect(daysSince(ago(0), NOW)).toBe(0);
  });

  it("is null for missing or unparseable timestamps", () => {
    expect(daysSince(null, NOW)).toBeNull();
    expect(daysSince("not a date", NOW)).toBeNull();
  });
});

describe("priceFindings", () => {
  it("says nothing about a healthy product", () => {
    expect(priceFindings(product(), NOW)).toEqual([]);
  });

  it("flags selling below cost as bad, with the loss per unit", () => {
    const f = priceFindings(product({ price: 900 }), NOW);
    expect(f[0].severity).toBe("bad");
    expect(f[0].code).toBe("below_cost");
    expect(f[0].message).toContain("R100.00");
  });

  it("warns on a margin too thin to survive fees", () => {
    const p = product({ price: 1020, cost: { ...product().cost!, cost_price: 1000 } });
    const f = priceFindings(p, NOW);
    expect(f.some((x) => x.code === "thin_margin")).toBe(true);
  });

  it("treats a missing cost as fatal for a distributor product but only a warning for a hand-sourced one", () => {
    const dist = priceFindings(product({ cost: { cost_price: null, selling_price: null, margin_percentage: null, axiz_product_id: "AX-1", updated_at: null } }), NOW);
    expect(dist.find((f) => f.code === "no_cost")!.severity).toBe("bad");

    const manual = priceFindings(product({ cost: null, specifications: { manually_sourced: true } }), NOW);
    expect(manual.find((f) => f.code === "no_cost")!.severity).toBe("warn");
  });

  it("escalates staleness with age", () => {
    expect(priceFindings(product({ last_synced_at: ago(1) }), NOW).some((f) => f.code === "stale")).toBe(false);
    expect(priceFindings(product({ last_synced_at: ago(3) }), NOW).find((f) => f.code === "stale")!.severity).toBe("warn");
    expect(priceFindings(product({ last_synced_at: ago(9) }), NOW).find((f) => f.code === "stale")!.severity).toBe("bad");
  });

  it("does NOT call a hand-sourced product stale", () => {
    // There is no feed behind it, so "last synced" is meaningless and its
    // absence is not a fault. Flagging it would train the owner to ignore the
    // staleness warning entirely -- which is the one that matters.
    const p = product({ cost: null, specifications: { manually_sourced: true, supplier: "GeeWiz" }, last_synced_at: null, price: 965 });
    expect(priceFindings(p, NOW).some((f) => f.code === "stale" || f.code === "never_synced")).toBe(false);
  });

  it("flags a product with no price at all", () => {
    expect(priceFindings(product({ price: 0 }), NOW).some((f) => f.code === "no_price")).toBe(true);
  });

  it("sorts worst first", () => {
    const p = product({ price: 900, last_synced_at: ago(3) });
    expect(priceFindings(p, NOW)[0].severity).toBe("bad");
  });
});

describe("worstSeverity", () => {
  it("is ok when there is nothing to report", () => {
    expect(worstSeverity([])).toBe("ok");
  });

  it("reports the worst present", () => {
    expect(worstSeverity(priceFindings(product({ price: 900 }), NOW))).toBe("bad");
    expect(worstSeverity(priceFindings(product({ last_synced_at: ago(3) }), NOW))).toBe("warn");
  });
});

describe("markupFor", () => {
  const rules = [
    { category: null, percent: 17 },
    { category: "Laptops", percent: 8 },
    { category: "Cables & Adapters", percent: 45 },
  ];

  it("uses the category rule when one exists", () => {
    expect(markupFor("Laptops", rules)).toBe(8);
    expect(markupFor("Cables & Adapters", rules)).toBe(45);
  });

  it("is case- and whitespace-insensitive", () => {
    expect(markupFor("  laptops ", rules)).toBe(8);
  });

  it("falls back to the default rule for anything else", () => {
    expect(markupFor("Smart Home", rules)).toBe(17);
    expect(markupFor(null, rules)).toBe(17);
    expect(markupFor(undefined, rules)).toBe(17);
  });

  it("matches exactly, never fuzzily", () => {
    // A rule that silently catches a category nobody intended is a pricing
    // error applied to a whole department.
    expect(markupFor("Laptop Bags", rules)).toBe(17);
    expect(markupFor("Gaming Laptops", rules)).toBe(17);
  });

  it("falls back to the built-in default when there is no fallback rule", () => {
    expect(markupFor("Anything", [{ category: "Laptops", percent: 8 }])).toBe(DEFAULT_MARKUP_PCT);
  });

  it("ignores a rule with a non-finite percent rather than pricing at NaN", () => {
    expect(markupFor("Laptops", [{ category: "Laptops", percent: NaN }, { category: null, percent: 17 }])).toBe(17);
  });
});

describe("sellingPriceFor", () => {
  it("applies markup and rounds to cents", () => {
    expect(sellingPriceFor(1000, 17)).toBe(1170);
    expect(sellingPriceFor(999.99, 17)).toBe(1169.99);
  });

  it("a zero markup sells at cost", () => {
    expect(sellingPriceFor(1000, 0)).toBe(1000);
  });
});
