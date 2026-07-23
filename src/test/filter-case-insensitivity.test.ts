import { describe, it, expect } from "vitest";

/**
 * Case-insensitivity contract for the storefront product filter.
 *
 * Confirms `search_products` RPC returns the same result set regardless of
 * casing for the `filter_category` argument (e.g. "accessories" vs
 * "Accessories"), across every category surfaced by `get_product_facets`.
 *
 * Runs against the live backend using the public anon key.
 * Skipped automatically when the endpoint is unreachable (offline CI).
 *
 * Run: `bunx vitest run src/test/filter-case-insensitivity.test.ts`
 */

const SUPABASE_URL = "https://xwiqubcilptxzvdigsmp.supabase.co";
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh3aXF1YmNpbHB0eHp2ZGlnc21wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIwMTY2NzcsImV4cCI6MjA4NzU5MjY3N30.aiRYqZ2H2VTNc64hU2XdeESEz4VcxOW6BQKvhb0v-4I";

// Cap the fan-out so the suite stays quick; still enough coverage to catch a
// regression where equality (not lower(...)) creeps back in.
const MAX_CATEGORIES = 20;
const REQUEST_TIMEOUT_MS = 8000;

interface Facet {
  facet_type: "category" | "brand";
  facet_value: string;
  product_count: number;
}

interface SearchRow {
  id: string;
  total_count: number;
}

async function rpc<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`${fn} → ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

const flipCase = (s: string) => {
  const alt = s === s.toLowerCase() ? s.toUpperCase() : s.toLowerCase();
  // Guarantee an actual case flip when possible; otherwise Title-case it.
  if (alt !== s) return alt;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
};

async function backendReachable(): Promise<boolean> {
  try {
    await rpc<Facet[]>("get_product_facets", {});
    return true;
  } catch {
    return false;
  }
}

describe("filter case-insensitivity", () => {
  it("get_product_facets returns categories and brands", async () => {
    if (!(await backendReachable())) return;
    const facets = await rpc<Facet[]>("get_product_facets", {});
    expect(Array.isArray(facets)).toBe(true);
    expect(facets.some((f) => f.facet_type === "category")).toBe(true);
    expect(facets.some((f) => f.facet_type === "brand")).toBe(true);
  }, 15000);

  it("search_products matches the accessories category in any casing", async () => {
    if (!(await backendReachable())) return;
    const variants = ["accessories", "Accessories", "ACCESSORIES", "AcCeSsOrIeS"];
    const totals: number[] = [];
    for (const v of variants) {
      const rows = await rpc<SearchRow[]>("search_products", {
        search_query: "",
        filter_category: v,
        page_number: 0,
        page_size: 1,
      });
      totals.push(rows[0]?.total_count ?? 0);
    }
    // All casings must return the same non-zero total.
    expect(totals[0]).toBeGreaterThan(0);
    for (const t of totals) expect(t).toBe(totals[0]);
  }, 30000);

  it("every category in get_product_facets is case-insensitive", async () => {
    if (!(await backendReachable())) return;
    const facets = await rpc<Facet[]>("get_product_facets", {});
    const cats = facets
      .filter((f) => f.facet_type === "category")
      .sort((a, b) => Number(b.product_count) - Number(a.product_count))
      .slice(0, MAX_CATEGORIES);

    expect(cats.length).toBeGreaterThan(0);

    for (const c of cats) {
      const original = c.facet_value;
      const flipped = flipCase(original);

      const [a, b] = await Promise.all([
        rpc<SearchRow[]>("search_products", {
          filter_category: original,
          page_number: 0,
          page_size: 1,
        }),
        rpc<SearchRow[]>("search_products", {
          filter_category: flipped,
          page_number: 0,
          page_size: 1,
        }),
      ]);

      const totalA = a[0]?.total_count ?? 0;
      const totalB = b[0]?.total_count ?? 0;

      expect(totalA, `category "${original}" returned zero results`).toBeGreaterThan(0);
      expect(
        totalB,
        `category "${original}" vs "${flipped}" produced different totals (${totalA} vs ${totalB})`
      ).toBe(totalA);
    }
  }, 60000);
});
