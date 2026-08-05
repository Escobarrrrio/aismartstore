// Where a product came from, what it cost, and whether its price can be trusted.
//
// The store buys from a distributor feed and, increasingly, from wherever the
// owner personally sources stock. Both end up as rows in `products`, and until
// now nothing on any screen distinguished them. That matters in three ways
// that only show up when something is wrong:
//
//   * A distributor price that stopped refreshing looks identical to one that
//     refreshed a minute ago. You find out it went stale when a customer pays
//     yesterday's price for today's cost.
//   * A hand-sourced product has no feed behind it at all, so "last synced"
//     is meaningless for it and its absence is not a fault.
//   * One flat markup across a catalogue that runs from R200 cables to R35,000
//     robot vacuums is not a pricing strategy. Real retailers set margin by
//     category, because a 17% margin on a cable is pennies and 17% on a
//     workstation is more than the market will bear.
//
// Pure functions, no database, no React -- so the rules can be tested and so
// the same answer is given wherever the question is asked.

export type SourceKind = "distributor" | "manual" | "unknown";

export interface CostRow {
  cost_price: number | null;
  selling_price: number | null;
  margin_percentage: number | null;
  axiz_product_id: string | null;
  updated_at: string | null;
}

export interface SourcedProduct {
  id: string;
  name: string;
  category: string | null;
  price: number | null;
  last_synced_at: string | null;
  specifications: Record<string, unknown> | null;
  cost: CostRow | null;
}

/**
 * Distributor rows carry an `axiz_product_id`; hand-sourced rows are tagged in
 * `specifications`. Anything with neither is genuinely unknown -- reported as
 * such rather than guessed, because "we do not know where this price came
 * from" is the finding, not a gap to paper over.
 */
export function sourceOf(p: SourcedProduct): SourceKind {
  if (p.cost?.axiz_product_id) return "distributor";
  if (p.specifications && p.specifications["manually_sourced"] === true) return "manual";
  if (p.specifications && typeof p.specifications["supplier"] === "string") return "manual";
  return "unknown";
}

/**
 * Realised margin as a percentage of the selling price.
 *
 * Deliberately margin, not markup. The sync stores markup (cost x 1.17) and
 * calls the column `margin_percentage`, which is a different number and the
 * classic way to believe you are making 17% when you are making 14.5%. This
 * returns what actually lands: (sell - cost) / sell.
 *
 * Null when it cannot be computed, never 0 -- "no cost recorded" and "sold at
 * cost" are very different and must not collapse into the same figure.
 */
export function realisedMarginPct(cost: number | null, sell: number | null): number | null {
  if (cost == null || sell == null) return null;
  if (!Number.isFinite(cost) || !Number.isFinite(sell)) return null;
  if (sell <= 0) return null;
  return ((sell - cost) / sell) * 100;
}

/** Markup as applied: what percentage was added on top of cost. */
export function appliedMarkupPct(cost: number | null, sell: number | null): number | null {
  if (cost == null || sell == null) return null;
  if (!Number.isFinite(cost) || !Number.isFinite(sell)) return null;
  if (cost <= 0) return null;
  return ((sell - cost) / cost) * 100;
}

/** How many whole days ago, or null when there is no timestamp. */
export function daysSince(iso: string | null, now: Date = new Date()): number | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  return Math.floor((now.getTime() - then) / 86_400_000);
}

export type Severity = "ok" | "warn" | "bad";

export interface PriceFinding {
  severity: Severity;
  code: string;
  message: string;
}

/**
 * How stale a distributor price is allowed to get before it is a problem.
 *
 * The sync runs every 15 minutes and a full catalogue pass takes several
 * hours, so a healthy row is refreshed daily. Two days is a warning; a week
 * means the sync has been failing for that product and nobody noticed.
 */
export const STALE_WARN_DAYS = 2;
export const STALE_BAD_DAYS = 7;

/**
 * Everything wrong with one product's pricing, worst first.
 *
 * Returns an empty array when there is nothing to say, so a caller can render
 * "fine" without knowing the rules.
 */
export function priceFindings(p: SourcedProduct, now: Date = new Date()): PriceFinding[] {
  const out: PriceFinding[] = [];
  const kind = sourceOf(p);
  const cost = p.cost?.cost_price ?? null;
  const sell = p.price ?? null;

  if (sell == null || sell <= 0) {
    out.push({ severity: "bad", code: "no_price", message: "No selling price." });
  }

  if (cost == null) {
    // Only a fault where a cost is expected. A hand-sourced listing may
    // legitimately have no cost recorded yet.
    out.push(
      kind === "distributor"
        ? { severity: "bad", code: "no_cost", message: "Distributor product with no cost on record — margin is unknown." }
        : { severity: "warn", code: "no_cost", message: "No cost recorded, so margin cannot be checked." },
    );
  } else if (sell != null && sell > 0) {
    const margin = realisedMarginPct(cost, sell)!;
    if (sell < cost) {
      out.push({ severity: "bad", code: "below_cost", message: `Selling below cost — losing R${(cost - sell).toFixed(2)} per unit.` });
    } else if (margin < 5) {
      out.push({ severity: "warn", code: "thin_margin", message: `Margin is only ${margin.toFixed(1)}% — a card fee and a courier eat that.` });
    }
  }

  // Freshness only means something where a feed is meant to be refreshing it.
  if (kind === "distributor") {
    const age = daysSince(p.last_synced_at, now);
    if (age == null) {
      out.push({ severity: "warn", code: "never_synced", message: "Never synced — this price has no refresh behind it." });
    } else if (age >= STALE_BAD_DAYS) {
      out.push({ severity: "bad", code: "stale", message: `Price last refreshed ${age} days ago — the sync is not reaching this product.` });
    } else if (age >= STALE_WARN_DAYS) {
      out.push({ severity: "warn", code: "stale", message: `Price last refreshed ${age} days ago.` });
    }
  }

  if (kind === "unknown") {
    out.push({ severity: "warn", code: "unknown_source", message: "No record of where this product or its price came from." });
  }

  const rank: Record<Severity, number> = { bad: 0, warn: 1, ok: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/** The worst thing wrong with a product, for a single at-a-glance badge. */
export function worstSeverity(findings: PriceFinding[]): Severity {
  if (findings.some((f) => f.severity === "bad")) return "bad";
  if (findings.some((f) => f.severity === "warn")) return "warn";
  return "ok";
}

// ---------------------------------------------------------------- markup

/** Markup rules, most specific first. A null category is the fallback. */
export interface MarkupRule {
  category: string | null;
  percent: number;
}

export const DEFAULT_MARKUP_PCT = 17;

/**
 * Resolves the markup for a category.
 *
 * Matching is case-insensitive and exact rather than fuzzy: a rule that
 * silently catches a category the owner did not intend is a pricing error
 * applied across a whole department, and "why is everything in Laptops 40%?"
 * is a much harder question than "why did my rule not apply?".
 */
export function markupFor(category: string | null | undefined, rules: MarkupRule[]): number {
  const wanted = (category ?? "").trim().toLowerCase();
  if (wanted) {
    const exact = rules.find((r) => (r.category ?? "").trim().toLowerCase() === wanted);
    if (exact && Number.isFinite(exact.percent)) return exact.percent;
  }
  const fallback = rules.find((r) => r.category == null);
  return fallback && Number.isFinite(fallback.percent) ? fallback.percent : DEFAULT_MARKUP_PCT;
}

/** Applies a markup to a cost, rounded to cents. */
export function sellingPriceFor(cost: number, markupPct: number): number {
  return Math.round(cost * (1 + markupPct / 100) * 100) / 100;
}
