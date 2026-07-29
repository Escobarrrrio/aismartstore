/**
 * Catalogue scope + facet display helpers shared by the products page and the
 * mobile filter sheet.
 */

/** Which slice of the catalogue is being browsed. Mirrors `products.audience`. */
export type Audience = "residential" | "business" | "all";

export const AUDIENCES: ReadonlyArray<{ value: Audience; label: string; hint: string }> = [
  { value: "residential", label: "Home", hint: "Everyday tech for households and home offices" },
  { value: "business", label: "Business", hint: "Enterprise, server and government-procurement gear" },
  { value: "all", label: "Everything", hint: "The full catalogue, home and enterprise together" },
];

/** Anything unrecognised falls back to the consumer storefront. */
export const parseAudience = (value: string | null): Audience =>
  value === "business" || value === "all" ? value : "residential";

/**
 * Facet values come straight out of the catalogue, where casing is inconsistent
 * between sources ("accessories" from the distributor feed, "Smart Home" from a
 * manual import). Title-case the all-lowercase ones and leave everything else
 * untouched, so real brand casing survives — HPE stays HPE, SwitchBot stays
 * SwitchBot, and we never render the initcap-mangled "Hpe" again.
 */
export const facetLabel = (value: string): string =>
  value === value.toLowerCase()
    ? value.replace(/\b[a-z]/g, (c) => c.toUpperCase())
    : value;

/**
 * Quick "Under R…" chips derived from the price range actually present in the
 * current result set, so they stay useful in every scope — a hardcoded
 * "Under R500" is meaningless in a catalogue whose cheapest item is R15 029.
 */
export const priceChipsFor = (min: number, max: number): number[] => {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return [];
  const nice = (n: number) => {
    const mag = Math.pow(10, Math.floor(Math.log10(Math.max(n, 1))));
    return Math.max(mag, Math.round(n / mag) * mag);
  };
  const out: number[] = [];
  for (const fraction of [0.25, 0.5, 0.75]) {
    const v = nice(min + (max - min) * fraction);
    if (v > min && v < max && !out.includes(v)) out.push(v);
  }
  return out;
};
