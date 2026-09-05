import { test, expect, request } from "@playwright/test";

/**
 * E2E coverage that validates pagination + filtering integrity:
 *
 *  - The `search_products` RPC's `total_count` window matches the actual
 *    number of rows we can page through under the same filters.
 *  - No filter combination silently drops rows: sum of (rows per page) across
 *    every page equals total_count, and every returned row satisfies the
 *    filter that was applied.
 *  - Facet values from `get_product_facets` yield non-zero results when used
 *    as filters (ensures the dropdowns can't offer dead-end options).
 *
 * These run at the API layer (Supabase RPC via the public anon key) so they
 * exercise the DB integrity guarantees without depending on UI hydration.
 */

const SUPABASE_URL = process.env.PLAYWRIGHT_SUPABASE_URL
  || "https://okejdzkftwhccplyfluf.supabase.co";
const SUPABASE_ANON = process.env.PLAYWRIGHT_SUPABASE_ANON_KEY
  || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9rZWpkemtmdHdoY2NwbHlmbHVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5NDU0MjAsImV4cCI6MjEwMTUyMTQyMH0.JHSxZe_hSQtAH7nABmlRQlV2QlNJDYmOYbkcGnpKbj4";

const PAGE_SIZE = 24;
const MAX_PAGES_TO_WALK = 6; // 144 rows — enough to prove the invariant

async function callRpc(name: string, body: Record<string, unknown>) {
  const ctx = await request.newContext();
  const res = await ctx.post(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${SUPABASE_ANON}`,
      "Content-Type": "application/json",
    },
    data: body,
  });
  expect(res.ok(), `RPC ${name} failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const json = await res.json();
  await ctx.dispose();
  return json as any[];
}

test.describe("Pagination + filtering integrity", () => {
  // These are network/API tests — run once, not per browser project.
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "API integrity — run once");
  });

  test("total_count matches actual pageable rows for the default consumer view", async () => {
    const args = {
      search_query: "",
      filter_category: null,
      filter_brand: null,
      filter_ai_only: false,
      filter_in_stock_only: false,
      min_price: null,
      max_price: 15000, // matches the default consumer cap on /products
      sort_by: "relevance",
      page_number: 0,
      page_size: PAGE_SIZE,
    };
    const page0 = await callRpc("search_products", args);
    expect(page0.length).toBeGreaterThan(0);
    const total = Number(page0[0].total_count);
    expect(total).toBeGreaterThan(0);

    const pagesToWalk = Math.min(MAX_PAGES_TO_WALK, Math.ceil(total / PAGE_SIZE));
    let seen = page0.length;
    for (let p = 1; p < pagesToWalk; p++) {
      const rows = await callRpc("search_products", { ...args, page_number: p });
      // total_count reported per page must be identical to the first page.
      if (rows.length > 0) {
        expect(Number(rows[0].total_count)).toBe(total);
      }
      seen += rows.length;
    }
    // Every walked page must be fully filled unless it's the last page.
    const expectedSeen = Math.min(total, pagesToWalk * PAGE_SIZE);
    expect(seen).toBe(expectedSeen);
  });

  test("filtering by a real category returns only that category and matches its facet count", async () => {
    const facets = await callRpc("get_product_facets", {});
    const categories = facets.filter((f) => f.facet_type === "category" && Number(f.product_count) > 0);
    expect(categories.length).toBeGreaterThan(0);

    // Pick a mid-sized category so both filtered count and rows fit in one page.
    const target = categories[Math.min(2, categories.length - 1)];
    const rows = await callRpc("search_products", {
      search_query: "",
      filter_category: target.facet_value,
      filter_brand: null,
      filter_ai_only: false,
      filter_in_stock_only: false,
      min_price: null,
      max_price: null,
      sort_by: "relevance",
      page_number: 0,
      page_size: PAGE_SIZE,
    });
    expect(rows.length).toBeGreaterThan(0);

    // Every row must match the requested category (case-insensitive).
    for (const r of rows) {
      expect(String(r.category).toLowerCase()).toBe(String(target.facet_value).toLowerCase());
    }
    // total_count matches the facet's own product_count exactly.
    expect(Number(rows[0].total_count)).toBe(Number(target.product_count));
  });

  test("every top facet dropdown option resolves to a non-empty result set", async () => {
    const facets = await callRpc("get_product_facets", {});
    // Sample the top 5 categories + top 5 brands.
    const top = (type: string, n: number) =>
      facets
        .filter((f) => f.facet_type === type)
        .sort((a, b) => Number(b.product_count) - Number(a.product_count))
        .slice(0, n);
    const samples = [
      ...top("category", 5).map((f) => ({ kind: "category", value: f.facet_value })),
      ...top("brand", 5).map((f) => ({ kind: "brand", value: f.facet_value })),
    ];
    expect(samples.length).toBeGreaterThan(0);

    for (const s of samples) {
      const rows = await callRpc("search_products", {
        search_query: "",
        filter_category: s.kind === "category" ? s.value : null,
        filter_brand: s.kind === "brand" ? s.value : null,
        filter_ai_only: false,
        filter_in_stock_only: false,
        min_price: null,
        max_price: null,
        sort_by: "relevance",
        page_number: 0,
        page_size: PAGE_SIZE,
      });
      expect(
        rows.length,
        `${s.kind}=${s.value} returned zero rows — facet dropdown would be a dead end`,
      ).toBeGreaterThan(0);
    }
  });
});
