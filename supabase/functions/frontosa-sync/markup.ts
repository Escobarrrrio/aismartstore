// Margin by category -- a deliberate, small duplicate of axiz-sync's own
// markup.ts (and src/lib/sourcing.ts, and the database's
// markup_for_category()). Edge functions can't import across function
// directories in this project, and a shared package is more machinery
// than forty lines of arithmetic warrants. All copies are tested against
// the same cases; if one changes, all change together.

export interface MarkupRule {
  category: string | null;
  percent: number;
}

export const DEFAULT_MARKUP_PCT = 17;

/**
 * The markup for a category, as a percentage. Exact and case-insensitive,
 * never fuzzy -- a rule that silently catches a category nobody intended
 * is a pricing error applied across a whole department.
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
