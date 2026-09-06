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

const SUPABASE_URL = "https://okejdzkftwhccplyfluf.supabase.co";
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9rZWpkemtmdHdoY2NwbHlmbHVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5NDU0MjAsImV4cCI6MjEwMTUyMTQyMH0.JHSxZe_hSQtAH7nABmlRQlV2QlNJDYmOYbkcGnpKbj4";

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

// A timeout via Promise.race, not AbortController's own signal: vitest's
// jsdom environment constructs its own AbortController/AbortSignal, which
// Node's native fetch (undici) rejects with "Expected signal to be an
// instance of AbortSignal" -- a cross-realm identity check, not a real
// incompatibility. That threw on every call, was caught by
// backendReachable()'s catch-all below, and reported as "backend
// unreachable" -- so this suite never ran a single real assertion under
// vitest+jsdom. Racing a plain timeout promise sidesteps passing any
// environment-constructed object into fetch at all.
class TimeoutError extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new TimeoutError(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

async function rpc<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const res = await withTimeout(
    fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    REQUEST_TIMEOUT_MS,
    fn,
  );
  if (!res.ok) throw new Error(`${fn} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

const flipCase = (s: string) => {
  const alt = s === s.toLowerCase() ? s.toUpperCase() : s.toLowerCase();
  // Guarantee an actual case flip when possible; otherwise Title-case it.
  if (alt !== s) return alt;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
};

// Only a genuine network/connectivity failure should be treated as "offline,
// skip". A bug in this file's own request-building code (exactly what the
// AbortSignal cross-realm mismatch was) must not be swallowed the same way --
// that is precisely how it went undetected. TypeError is fetch's own class
// for connection failures (refused, DNS, timeout-via-rejection); anything
// else -- including an assertion-relevant HTTP error surfaced as a plain
// Error from rpc() -- is rethrown so the test fails loudly instead of
// quietly reporting "unreachable".
async function backendReachable(): Promise<boolean> {
  try {
    await rpc<Facet[]>("get_product_facets", {});
    return true;
  } catch (e) {
    // TypeError: fetch's own class for connection-level failures (refused,
    // DNS, reset). TimeoutError: this file's own race, for a runner that
    // can't get a response in time -- also a connectivity symptom, not a
    // code bug. Anything else (e.g. the Error rpc() throws for a non-2xx
    // response) is assertion-relevant and must fail the test, not vanish
    // into "unreachable, skipping".
    if (e instanceof TypeError || e instanceof TimeoutError) return false;
    throw e;
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

  it("search_products matches a real residential category in any casing", async () => {
    if (!(await backendReachable())) return;
    // "accessories" was a hardcoded guess, and had been wrong since well
    // before this suite could ever actually run: the canonical fallback
    // bucket is "Accessories (General)", not "accessories" -- classify_
    // product_category has named it that since 20260729. Discovering a real,
    // currently non-empty category instead of hardcoding one means this
    // can't go stale the same way again.
    const facets = await rpc<Facet[]>("get_product_facets", {});
    const candidate = facets.find((f) => f.facet_type === "category" && f.product_count > 0);
    expect(candidate, "no category with any products at all").toBeDefined();
    const target = candidate!.facet_value;

    const variants = [target, target.toLowerCase(), target.toUpperCase(), flipCase(target)];
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
    // All casings must return the same total -- whatever it is. Not
    // asserted non-zero: get_product_facets is unscoped by audience (see
    // below), so an anonymous caller can legitimately see 0 for a
    // business-only category.
    for (const t of totals) expect(t).toBe(totals[0]);
  }, 30000);

  it("every residential-visible category in get_product_facets is case-insensitive", async () => {
    if (!(await backendReachable())) return;
    const facets = await rpc<Facet[]>("get_product_facets", {});
    const cats = facets
      .filter((f) => f.facet_type === "category")
      .sort((a, b) => Number(b.product_count) - Number(a.product_count))
      .slice(0, MAX_CATEGORIES);

    expect(cats.length).toBeGreaterThan(0);

    let checked = 0;
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

      // get_product_facets() is SECURITY DEFINER over an unscoped cache --
      // it lists every category regardless of audience. search_products
      // correctly clamps an anonymous caller (auth.uid() IS NULL, as this
      // suite's anon key is) to residential only. A business-only category
      // -- "Servers & Data Centre" among them, by explicit design -- returns
      // 0 here, and that is the "server-side B2B exclusion for signed-out
      // visitors" security fix working, not a bug this test should catch.
      // Case-insensitivity is what this test owns; skip what it doesn't.
      if (totalA === 0 && totalB === 0) continue;
      checked++;

      expect(
        totalB,
        `category "${original}" vs "${flipped}" produced different totals (${totalA} vs ${totalB})`
      ).toBe(totalA);
    }
    expect(checked, "no residential-visible category found to check").toBeGreaterThan(0);
  }, 60000);
});
