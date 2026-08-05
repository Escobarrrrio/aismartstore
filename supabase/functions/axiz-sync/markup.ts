// Margin by category.
//
// A deliberate, small duplicate of the resolution rules in
// `src/lib/sourcing.ts`. Edge functions run in Deno off `supabase/functions`
// and cannot import from the Vite app's `src/`, and the alternative -- a
// shared package -- is more machinery than forty lines of arithmetic warrants.
// Both copies are separately tested against the same cases, and the database's
// `markup_for_category()` is a third implementation of the same rule for SQL
// callers. If one changes, all three change.
//
// Why any of this exists: every product was priced `cost x 1.17`, from R200
// cables to R35,000 workstations. 17% on a cable is R34, which a card fee and
// a courier bag consume; 17% on a workstation is R5,950 on a line where the
// market pays single digits.

export interface MarkupRule {
  category: string | null;
  percent: number;
}

export const DEFAULT_MARKUP_PCT = 17;

/**
 * The markup for a category, as a percentage.
 *
 * Exact and case-insensitive, never fuzzy. A rule that silently catches a
 * category nobody intended is a pricing error applied across a whole
 * department, and it is far harder to notice after the fact than a rule that
 * simply did not apply.
 *
 * A rule whose percent is not a finite number is ignored rather than allowed
 * to price a product at NaN -- which would sail through as `null` and publish
 * a product with no price.
 */
export function markupFor(category: string | null | undefined, rules: MarkupRule[]): number {
  const wanted = (category ?? "").trim().toLowerCase();
  if (wanted) {
    const exact = rules.find(
      (r) => r.category != null && r.category.trim().toLowerCase() === wanted && Number.isFinite(r.percent),
    );
    if (exact) return exact.percent;
  }
  const fallback = rules.find((r) => r.category == null && Number.isFinite(r.percent));
  return fallback ? fallback.percent : DEFAULT_MARKUP_PCT;
}

/** Applies a markup to a cost, rounded to cents. */
export function sellingPriceFor(cost: number, markupPct: number): number {
  return Math.round(cost * (1 + markupPct / 100) * 100) / 100;
}
