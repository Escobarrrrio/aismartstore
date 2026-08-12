import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import ProductCard from "@/components/ProductCard";
import MobileFilterSheet from "@/components/products/MobileFilterSheet";
import FacetList from "@/components/products/FacetList";
import SEO from "@/components/SEO";
import { Package, Search, SlidersHorizontal, X, ChevronDown, ChevronLeft, ChevronRight, Sparkles, PackageCheck } from "lucide-react";
import type { Product } from "@/contexts/CartContext";
import { supabase } from "@/integrations/supabase/client";
import { useTranslation } from "react-i18next";
import { formatMoney } from "@/lib/currency";
import { trackEvent } from "@/lib/analytics";
import { AUDIENCES, facetLabel, parseAudience, priceChipsFor, type Audience } from "@/lib/facets";

type SortOption = "relevance" | "price_asc" | "price_desc" | "newest";

const PAGE_SIZE = 48;

interface Row {
  id: string;
  sku: string | null;
  slug?: string | null;
  name: string;
  description: string | null;
  price: number | string;
  category: string | null;
  brand: string | null;
  stock_quantity?: number;
  in_stock: boolean;
  images: string[] | null;
  is_ai_product: boolean | null;
  total_count: number | string;
}

const toProduct = (r: Row): Product => ({
  id: r.id,
  name: r.name,
  description: r.description || "",
  price: Number(r.price),
  category: r.category || "",
  brand: r.brand || undefined,
  sku: r.sku || undefined,
  images: r.images || [],
  inStock: r.in_stock,
  stockQuantity: typeof r.stock_quantity === "number" ? r.stock_quantity : undefined,
  isAiProduct: !!r.is_ai_product,
  createdAt: new Date().toISOString(),
});

type FacetOption = { value: string; count: number };

// Everything the sidebar needs, all counted in the CURRENT filter context by
// `search_product_facets` so no number on screen can disagree with the grid.
type Facets = {
  categories: FacetOption[];
  brands: FacetOption[];
  aiReady: number;
  inStock: number;
  priceMin: number;
  priceMax: number;
};

const EMPTY_FACETS: Facets = {
  categories: [], brands: [], aiReady: 0, inStock: 0, priceMin: 0, priceMax: 0,
};

type FacetRow = { facet_type: string; facet_value: string; product_count: number | string };

const fmtCount = (n: number) => n.toLocaleString("en-ZA").replace(/,/g, " ");

const Products = () => {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();

  // ── URL is the source of truth ───────────────────────────────────────────
  // Every filter is serialized into the query string so Back/Forward restore
  // the exact result set (and links are shareable). We hydrate local state
  // from `searchParams` on every render — the router already re-renders on
  // popstate, so no manual popstate listener is needed.
  const urlQ = searchParams.get("q") || "";
  const urlCategory = searchParams.get("category") || "";
  const urlBrand = searchParams.get("brand") || "";
  const urlAiOnly = searchParams.get("ai") === "1";
  const urlInStockOnly = searchParams.get("stock") === "1";
  const urlAudience = parseAudience(searchParams.get("audience"));
  const urlMinPrice = searchParams.get("min") || "";
  const urlMaxPrice = searchParams.get("max") || "";
  const urlSort = (searchParams.get("sort") || "relevance") as SortOption;
  const urlPage = Math.max(0, Number(searchParams.get("page") || "0") - 1) || 0;

  const [searchInput, setSearchInput] = useState(urlQ);
  const [query, setQuery] = useState(urlQ);
  const [category, setCategory] = useState(urlCategory);
  const [brand, setBrand] = useState(urlBrand);
  const [aiOnly, setAiOnly] = useState(urlAiOnly);
  const [inStockOnly, setInStockOnly] = useState(urlInStockOnly);
  const [audience, setAudience] = useState<Audience>(urlAudience);
  const [minPrice, setMinPrice] = useState<string>(urlMinPrice);
  const [maxPrice, setMaxPrice] = useState<string>(urlMaxPrice);
  const [sort, setSort] = useState<SortOption>(urlSort);
  const [page, setPage] = useState(urlPage);
  const [showFilters, setShowFilters] = useState(false);

  // Fire storefront_viewed once per mount so audience split can be validated
  // in prod analytics.
  useEffect(() => {
    trackEvent({ name: "storefront_viewed", audience: urlAudience, surface: "products", query: urlQ || undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [rows, setRows] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [facets, setFacets] = useState<Facets>(EMPTY_FACETS);
  const [facetsLoading, setFacetsLoading] = useState(true);
  const [facetsError, setFacetsError] = useState(false);
  // Bumped by the retry button to re-run the facet query without a page reload.
  const [facetNonce, setFacetNonce] = useState(0);

  // Re-hydrate local state from URL on browser Back/Forward (popstate). The
  // router re-invokes this component with fresh `searchParams`; syncing here
  // keeps local state consistent without wiping user typing.
  useEffect(() => {
    setSearchInput(urlQ);
    setQuery(urlQ);
    setCategory(urlCategory);
    setBrand(urlBrand);
    setAiOnly(urlAiOnly);
    setInStockOnly(urlInStockOnly);
    setAudience(urlAudience);
    setMinPrice(urlMinPrice);
    setMaxPrice(urlMaxPrice);
    setSort(urlSort);
    setPage(urlPage);
  }, [urlQ, urlCategory, urlBrand, urlAiOnly, urlInStockOnly, urlAudience, urlMinPrice, urlMaxPrice, urlSort, urlPage]);

  // Serialize state → URL. `replace: true` avoids polluting history on every
  // keystroke; a full push only happens on hard navigations elsewhere.
  useEffect(() => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (category) params.set("category", category);
    if (brand) params.set("brand", brand);
    if (aiOnly) params.set("ai", "1");
    if (inStockOnly) params.set("stock", "1");
    if (audience !== "residential") params.set("audience", audience);
    if (minPrice) params.set("min", minPrice);
    if (maxPrice) params.set("max", maxPrice);
    if (sort && sort !== "relevance") params.set("sort", sort);
    if (page > 0) params.set("page", String(page + 1));
    // Avoid feedback loop: only write if different.
    const next = params.toString();
    const current = searchParams.toString();
    if (next !== current) setSearchParams(params, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, category, brand, aiOnly, inStockOnly, audience, minPrice, maxPrice, sort, page]);

  // ── Live facet counts ────────────────────────────────────────────────────
  // Counted by `search_product_facets` against the exact same predicates as the
  // grid, so every number in the sidebar is precisely what you get by clicking
  // it. Each facet relaxes its own selection server-side, which is what lets a
  // shopper switch from "Servers" to "Cables" without the list collapsing.
  const facetArgs = useMemo(() => ({
    search_query: query,
    filter_category: category || null,
    filter_brand: brand || null,
    filter_ai_only: aiOnly,
    filter_in_stock_only: inStockOnly,
    min_price: minPrice ? Number(minPrice) : null,
    max_price: maxPrice ? Number(maxPrice) : null,
    filter_audience: audience,
  }), [query, category, brand, aiOnly, inStockOnly, minPrice, maxPrice, audience]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setFacetsLoading(true);
      const { data, error } = await supabase.rpc("search_product_facets", facetArgs);
      if (cancelled) return;
      if (error || !Array.isArray(data)) {
        setFacetsError(true);
        setFacetsLoading(false);
        return;
      }
      const next: Facets = { ...EMPTY_FACETS, categories: [], brands: [] };
      for (const r of data as FacetRow[]) {
        if (!r?.facet_value) continue;
        const count = Number(r.product_count) || 0;
        if (r.facet_type === "category") next.categories.push({ value: r.facet_value, count });
        else if (r.facet_type === "brand") next.brands.push({ value: r.facet_value, count });
        else if (r.facet_type === "toggle") {
          if (r.facet_value === "ai_ready") next.aiReady = count;
          else if (r.facet_value === "in_stock") next.inStock = count;
        } else if (r.facet_type === "meta") {
          if (r.facet_value === "price_min") next.priceMin = count;
          else if (r.facet_value === "price_max") next.priceMax = count;
        }
      }
      const byCount = (a: FacetOption, b: FacetOption) =>
        b.count - a.count || a.value.localeCompare(b.value);
      next.categories.sort(byCount);
      next.brands.sort(byCount);
      setFacets(next);
      setFacetsError(false);
      setFacetsLoading(false);
    })();
    return () => { cancelled = true; };
  }, [facetArgs, facetNonce]);

  const priceChips = useMemo(
    () => priceChipsFor(facets.priceMin, facets.priceMax),
    [facets.priceMin, facets.priceMax],
  );



  // Intelligent prefetch cache keyed by the exact RPC args (search + filters +
  // page). When the user changes filters, we hit the network for the current
  // page and, in the background, warm the *next* page so pagination clicks feel
  // instant. Cache is bounded to keep memory tiny (last 12 pages).
  type PageCache = { rows: Product[]; total: number };
  const prefetchCache = useRef<Map<string, PageCache>>(new Map());
  const inflightPrefetch = useRef<Set<string>>(new Set());

  const buildRpcArgs = useCallback((pageIndex: number) => {
    const min = minPrice ? Number(minPrice) : null;
    const max = maxPrice ? Number(maxPrice) : null;
    return {
      search_query: query,
      filter_category: category || null,
      filter_brand: brand || null,
      filter_ai_only: aiOnly,
      filter_in_stock_only: inStockOnly,
      min_price: min,
      max_price: max,
      sort_by: sort,
      page_number: pageIndex,
      page_size: PAGE_SIZE,
      // Catalogue scope is a real, URL-addressable filter: /products defaults to
      // the consumer storefront, ?audience=business is the enterprise catalogue
      // the Business Portal links into, ?audience=all spans both.
      filter_audience: audience,
    };
  }, [query, category, brand, aiOnly, inStockOnly, minPrice, maxPrice, sort, audience]);

  const cacheKey = useCallback((pageIndex: number) =>
    JSON.stringify(buildRpcArgs(pageIndex)), [buildRpcArgs]);

  // Background fetch — never blocks UI, never toggles loading state.
  const prefetchPage = useCallback(async (pageIndex: number) => {
    if (pageIndex < 0) return;
    const key = cacheKey(pageIndex);
    if (prefetchCache.current.has(key) || inflightPrefetch.current.has(key)) return;
    inflightPrefetch.current.add(key);
    try {
      const { data, error } = await supabase.rpc("search_products", buildRpcArgs(pageIndex));
      if (!error) {
        const list = (data as Row[]) || [];
        prefetchCache.current.set(key, {
          rows: list.map(toProduct),
          total: list[0]?.total_count ? Number(list[0].total_count) : list.length,
        });
        // Bound cache size.
        if (prefetchCache.current.size > 12) {
          const firstKey = prefetchCache.current.keys().next().value;
          if (firstKey) prefetchCache.current.delete(firstKey);
        }
      }
    } finally {
      inflightPrefetch.current.delete(key);
    }
  }, [buildRpcArgs, cacheKey]);

  const runSearch = useCallback(async () => {
    const key = cacheKey(page);
    // Hydrate instantly from prefetch cache when available.
    const cached = prefetchCache.current.get(key);
    if (cached) {
      setRows(cached.rows);
      setTotal(cached.total);
      setLoading(false);
    } else {
      setLoading(true);
      const { data, error } = await supabase.rpc("search_products", buildRpcArgs(page));
      if (error) {
        setRows([]);
        setTotal(0);
      } else {
        const list = (data as Row[]) || [];
        const rowsOut = list.map(toProduct);
        const totalOut = list[0]?.total_count ? Number(list[0].total_count) : list.length;
        setRows(rowsOut);
        setTotal(totalOut);
        prefetchCache.current.set(key, { rows: rowsOut, total: totalOut });
        trackEvent({
          name: "product_list_returned",
          audience,
          surface: "products",
          count: rowsOut.length,
          total: totalOut,
          query: query || undefined,
        });
      }
      setLoading(false);
    }
    // Kick off background prefetch of the next page so pagination is instant.
    // Only prefetch if there IS a next page (based on total we now know).
    const knownTotal = prefetchCache.current.get(key)?.total ?? 0;
    const knownPages = Math.ceil(knownTotal / PAGE_SIZE);
    if (page + 1 < knownPages) {
      // Fire and forget — errors don't affect the visible page.
      void prefetchPage(page + 1);
    }
  }, [page, buildRpcArgs, cacheKey, prefetchPage, audience, query]);

  useEffect(() => { runSearch(); }, [runSearch]);

  // Invalidate the prefetch cache whenever filters/query change so we never
  // show stale pages after a filter switch.
  useEffect(() => {
    prefetchCache.current.clear();
    inflightPrefetch.current.clear();
  }, [query, category, brand, aiOnly, inStockOnly, audience, minPrice, maxPrice, sort]);


  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // Catalogue scope is deliberately NOT counted here: it's which shop you're
  // standing in, not a refinement you'd expect "Reset all filters" to undo.
  const activeFilters = [category, brand, aiOnly ? "ai" : "", inStockOnly ? "stock" : "", minPrice, maxPrice].filter(Boolean).length;

  const applySearch = (e?: React.FormEvent) => {
    e?.preventDefault();
    const q = searchInput.trim();
    setQuery(q);
    setPage(0);
    // URL sync effect writes the change; no explicit setSearchParams needed.
  };

  const clearFilters = () => {
    setCategory(""); setBrand(""); setAiOnly(false); setInStockOnly(false);
    setMinPrice(""); setMaxPrice(""); setPage(0);
    trackEvent({ name: "filters_cleared_all", page: "/products" });
  };

  const pageNumbers = useMemo(() => {
    const nums: number[] = [];
    const window = 2;
    const start = Math.max(0, page - window);
    const end = Math.min(totalPages - 1, page + window);
    for (let i = start; i <= end; i++) nums.push(i);
    return nums;
  }, [page, totalPages]);

  const onRetryFacets = useCallback(() => {
    setFacetsError(false);
    setFacetNonce((n) => n + 1);
  }, []);

  // Switching catalogue scope resets the refinements below it. Category, brand
  // and price ranges are scope-specific taxonomies — carrying "Smart Home" or
  // "under R2 000" into a catalogue whose cheapest line is R15 029 would strand
  // the shopper on an empty grid. The search term is kept, since that's the one
  // thing they clearly still want.
  const onAudienceChange = useCallback((next: Audience) => {
    setAudience(next);
    setCategory(""); setBrand(""); setMinPrice(""); setMaxPrice("");
    setPage(0);
    trackEvent({ name: "audience_changed", value: next, page: "/products" });
  }, []);

  // Facet setters with analytics tracking. Selecting a value fires
  // "facet_selected"; clearing (empty string) fires "facet_cleared".
  const onCategoryChange = useCallback((v: string) => {
    setCategory(v); setPage(0);
    trackEvent(v
      ? { name: "facet_selected", facet: "category", value: v, page: "/products" }
      : { name: "facet_cleared", facet: "category", page: "/products" });
  }, []);
  const onBrandChange = useCallback((v: string) => {
    setBrand(v); setPage(0);
    trackEvent(v
      ? { name: "facet_selected", facet: "brand", value: v, page: "/products" }
      : { name: "facet_cleared", facet: "brand", page: "/products" });
  }, []);
  const onSortChange = useCallback((v: SortOption) => {
    setSort(v); setPage(0);
    trackEvent({ name: "sort_changed", value: v, page: "/products" });
  }, []);
  const onPageChange = useCallback((n: number) => {
    setPage(n);
    trackEvent({ name: "page_changed", value: n + 1, page: "/products" });
  }, []);

  // Active-filter chips model — rendered above the grid so shoppers always see
  // (and can dismiss) each filter they've applied. Mirrors Takealot/Amazon.
  // Every clear() emits an "active_filter_chip_dismissed" event for analytics.
  type Chip = { key: string; label: string; ariaLabel: string; clear: () => void };
  const chip = (key: Chip["key"], label: string, clear: () => void): Chip => ({
    key,
    label,
    ariaLabel: `Remove filter: ${label}`,
    clear: () => {
      trackEvent({ name: "active_filter_chip_dismissed", key, label, page: "/products" });
      clear();
    },
  });
  const activeChips: Chip[] = [];
  if (query) activeChips.push(chip("q", `“${query}”`, () => { setSearchInput(""); setQuery(""); setPage(0); }));
  if (category) activeChips.push(chip("cat", facetLabel(category), () => { setCategory(""); setPage(0); }));
  if (brand) activeChips.push(chip("brand", facetLabel(brand), () => { setBrand(""); setPage(0); }));
  if (aiOnly) activeChips.push(chip("ai", "AI ready", () => { setAiOnly(false); setPage(0); }));
  if (inStockOnly) activeChips.push(chip("stock", "In stock", () => { setInStockOnly(false); setPage(0); }));
  
  if (minPrice) activeChips.push(chip("min", `Min ${formatMoney(Number(minPrice))}`, () => { setMinPrice(""); setPage(0); }));
  if (maxPrice) activeChips.push(chip("max", `Max ${formatMoney(Number(maxPrice))}`, () => { setMaxPrice(""); setPage(0); }));



  return (
    <div className="min-h-screen">
      <SEO
        title={query ? `${query} — ${t("products.title")}` : t("products.title")}
        description="Browse AI hardware, networking, computing and enterprise software at AI Smart Store."
        path="/products"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: query ? `Search: ${query}` : "AI Smart Store products",
          numberOfItems: rows.length,
          itemListElement: rows.slice(0, 24).map((r, i) => ({
            "@type": "ListItem",
            position: page * PAGE_SIZE + i + 1,
            url: `https://aismartstore.co.za/product/${r.id}`,
            name: r.name,
          })),
        }}
      />

      {/* Header — a real colour band, not the near-invisible 2-6% opacity
          wash this used to share with the home hero. That version read as
          plain white with a headline on it; the badge/glow strengths below
          reuse the exact gradient-brand + white-text combo the "Smart Pick"
          badge already ships in production (ProductCard.tsx), so this isn't
          a new, unvetted colour pairing -- just the same one at header scale. */}
      <div className="relative overflow-hidden border-b border-border">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.08] via-secondary/[0.05] to-accent/[0.10]" />
        <div className="absolute top-0 right-0 w-[480px] h-[480px] gradient-brand opacity-[0.14] rounded-full blur-3xl -translate-y-1/2 translate-x-1/4" />
        <div className="absolute -bottom-24 -left-24 w-[320px] h-[320px] gradient-brand opacity-[0.08] rounded-full blur-3xl" />
        <div className="container mx-auto px-4 py-10 md:py-14 relative">
          <div className="inline-flex items-center gap-2 gradient-brand rounded-full px-4 py-1.5 text-xs font-bold text-white mb-5 shadow-sm">
            <Package className="h-3.5 w-3.5" />
            {audience === "business" ? "Business & government catalogue" : audience === "all" ? "Full catalogue" : t("products.title")}
          </div>
          <h1 className="text-4xl md:text-5xl font-display font-extrabold tracking-tight mb-3">
            <span className="gradient-brand-text">{t("products.catalogueHeading")}</span>
          </h1>
          <p className="text-muted-foreground text-base" data-testid="results-count" data-total={total} data-loading={loading} data-audience={audience}>
            {loading
              ? "Searching…"
              : query
                ? `${total.toLocaleString("en-ZA")} results for "${query}"`
                : `${total.toLocaleString("en-ZA")} products`}
            {!loading && audience !== "residential" && (
              <span className="ml-1">
                · {audience === "business" ? "Business & government catalogue" : "Full catalogue"}
              </span>
            )}
          </p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
        {/* Filter sidebar (desktop) -- was a flat card-flat box with plain
            grey checkboxes and 11px counts: functionally complete (scope,
            category, brand, price, AI/stock toggles) but visually read as
            an afterthought next to the header above it. Same bold-colour
            direction as the header: a real accent border, a coloured active
            state on the scope switcher, and a section-label rhythm instead
            of uniform grey uppercase everywhere. */}
        <aside className="hidden lg:block">
          <div className="bg-card rounded-2xl border border-border/60 shadow-[0_1px_3px_hsl(var(--foreground)/0.04)] p-5 sticky top-24 space-y-6 max-h-[calc(100vh-7rem)] overflow-y-auto">
            <div>
              <label className="flex items-center gap-1.5 text-xs font-bold text-foreground uppercase tracking-wider mb-2.5">
                <span className="w-1 h-3.5 rounded-full gradient-brand" aria-hidden="true" />
                Catalogue
              </label>
              <div role="radiogroup" aria-label="Catalogue scope" data-testid="catalogue-scope" className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-muted">
                {AUDIENCES.map((a) => {
                  const active = audience === a.value;
                  return (
                    <button
                      key={a.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      title={a.hint}
                      data-testid={`scope-${a.value}`}
                      onClick={() => onAudienceChange(a.value)}
                      className={`rounded-lg px-2 py-1.5 text-xs font-bold transition-all ${
                        active ? "gradient-brand text-white shadow-sm" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {a.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <FacetList
              label="Category"
              options={facets.categories}
              selected={category}
              onSelect={onCategoryChange}
              loading={facetsLoading}
              error={facetsError}
              onRetry={onRetryFacets}
              initialVisible={10}
            />
            <FacetList
              label="Brand"
              options={facets.brands}
              selected={brand}
              onSelect={onBrandChange}
              loading={facetsLoading}
              error={facetsError}
              onRetry={onRetryFacets}
              initialVisible={8}
            />

            <div>
              <label className="flex items-center gap-1.5 text-xs font-bold text-foreground uppercase tracking-wider mb-2.5">
                <span className="w-1 h-3.5 rounded-full gradient-brand" aria-hidden="true" />
                Price (ZAR)
              </label>
              <div className="flex gap-2">
                <input type="number" min="0" placeholder="Min" value={minPrice}
                  onChange={(e) => { setMinPrice(e.target.value); setPage(0); }}
                  className="input-premium" aria-label="Minimum price" />
                <input type="number" min="0" placeholder="Max" value={maxPrice}
                  onChange={(e) => { setMaxPrice(e.target.value); setPage(0); }}
                  className="input-premium" aria-label="Maximum price" />
              </div>
              {/* Chips derived from the real price spread of the current result
                  set — a fixed "Under R500" is noise in the enterprise catalogue. */}
              {priceChips.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2.5">
                  {priceChips.map((p) => (
                    <button key={p} type="button"
                      onClick={() => { setMaxPrice(String(p)); setPage(0); }}
                      className="text-[11px] font-semibold px-2.5 py-1 rounded-full border border-border/70 hover:border-primary hover:bg-primary/5 hover:text-primary transition-colors">
                      Under {formatMoney(p)}
                    </button>
                  ))}
                </div>
              )}
              {facets.priceMax > 0 && (
                <p className="text-[11px] text-muted-foreground mt-2.5">
                  Available range: {formatMoney(facets.priceMin)} – {formatMoney(facets.priceMax)}
                </p>
              )}
            </div>

            <div className="border-t border-border pt-5 space-y-1">
              {/* Counts come from the same query as the grid, so the number
                  beside a toggle is exactly what flipping it will show.
                  Rows now shade in when checked so the two toggles read as
                  real filter controls, not stray native checkboxes dropped
                  into a plain list. */}
              <label className={`flex items-center gap-3 text-sm px-2.5 py-2 -mx-2.5 rounded-lg transition-colors ${
                facets.aiReady === 0 && !aiOnly ? "opacity-40 cursor-not-allowed" : "cursor-pointer hover:bg-muted"
              } ${aiOnly ? "bg-primary/[0.06]" : ""}`}>
                <input type="checkbox" checked={aiOnly}
                  disabled={facets.aiReady === 0 && !aiOnly}
                  onChange={(e) => { setAiOnly(e.target.checked); setPage(0); }}
                  className="w-4 h-4 rounded accent-primary" />
                <span className="inline-flex items-center gap-1.5 flex-1 font-medium"><Sparkles className="h-3.5 w-3.5 text-primary" /> AI products only</span>
                <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">{fmtCount(facets.aiReady)}</span>
              </label>
              <label className={`flex items-center gap-3 text-sm px-2.5 py-2 -mx-2.5 rounded-lg transition-colors ${
                facets.inStock === 0 && !inStockOnly ? "opacity-40 cursor-not-allowed" : "cursor-pointer hover:bg-muted"
              } ${inStockOnly ? "bg-primary/[0.06]" : ""}`}>
                <input type="checkbox" checked={inStockOnly}
                  disabled={facets.inStock === 0 && !inStockOnly}
                  onChange={(e) => { setInStockOnly(e.target.checked); setPage(0); }}
                  className="w-4 h-4 rounded accent-primary" />
                <span className="flex-1 font-medium">In stock only</span>
                <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">{fmtCount(facets.inStock)}</span>
              </label>
              <p className="text-xs text-muted-foreground leading-relaxed pt-3">
                <PackageCheck className="h-3.5 w-3.5 inline mr-1" />
                Need a formal quote, tender response or the full compliance pack?
                Our <a href="/procurement" className="text-primary font-semibold hover:underline">Business Portal</a> handles
                government and enterprise procurement.
              </p>
            </div>

            <button
              onClick={() => { setSearchInput(""); setQuery(""); clearFilters(); }}
              disabled={activeFilters === 0 && !query}
              className="btn-secondary w-full px-3 py-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <X className="h-4 w-4" />
              Reset all filters{activeFilters > 0 ? ` (${activeFilters})` : ""}
            </button>
          </div>
        </aside>


        <div>
          {/* Search + sort controls */}
          <div className="flex flex-col sm:flex-row gap-3 mb-6">
            <form onSubmit={applySearch} className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder={t("products.searchPlaceholder")}
                className="input-premium input-premium-icon-l"
              />
              {searchInput && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => { setSearchInput(""); setQuery(""); setPage(0); }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </form>
            <div className="flex gap-2">
              <button
                onClick={() => setShowFilters(!showFilters)}
                aria-label={`Open filters${activeFilters > 0 ? ` (${activeFilters} active)` : ""}`}
                aria-expanded={showFilters}
                className={`btn-secondary px-4 py-3 text-sm lg:hidden ${showFilters ? 'border-primary bg-primary/[0.04]' : ''}`}
              >
                <SlidersHorizontal className="h-4 w-4" />
                Filters
                {activeFilters > 0 && (
                  <span className="ml-1 w-5 h-5 rounded-full gradient-brand text-white text-xs flex items-center justify-center" aria-hidden="true">{activeFilters}</span>
                )}
              </button>
              <div className="relative">
                <label htmlFor="products-sort" className="sr-only">Sort products</label>
                <select
                  id="products-sort"
                  aria-label="Sort products"
                  value={sort}
                  onChange={(e) => onSortChange(e.target.value as SortOption)}
                  className="input-premium input-premium-icon-r appearance-none cursor-pointer min-w-[180px]"
                >
                  <option value="relevance">Relevance</option>
                  <option value="price_asc">Price: low to high</option>
                  <option value="price_desc">Price: high to low</option>
                  <option value="newest">Newest</option>
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              </div>
            </div>
          </div>

          {/* Mobile filter bottom-sheet (Radix/vaul-backed) */}
          <MobileFilterSheet
            open={showFilters}
            onOpenChange={setShowFilters}
            categories={facets.categories}
            brands={facets.brands}
            facetsLoading={facetsLoading}
            facetsError={facetsError}
            onRetryFacets={onRetryFacets}
            category={category}
            brand={brand}
            minPrice={minPrice}
            maxPrice={maxPrice}
            aiOnly={aiOnly}
            inStockOnly={inStockOnly}
            aiReadyCount={facets.aiReady}
            inStockCount={facets.inStock}
            priceChips={priceChips}
            priceMin={facets.priceMin}
            priceMax={facets.priceMax}
            audience={audience}
            setAudience={onAudienceChange}
            sort={sort}
            setCategory={onCategoryChange}
            setBrand={onBrandChange}
            setMinPrice={(v) => { setMinPrice(v); setPage(0); }}
            setMaxPrice={(v) => { setMaxPrice(v); setPage(0); }}
            setAiOnly={(v) => { setAiOnly(v); setPage(0); }}
            setInStockOnly={(v) => { setInStockOnly(v); setPage(0); }}
            setSort={onSortChange}
            resultCount={total}
            activeFilters={activeFilters}
            onClearAll={() => { setSearchInput(""); setQuery(""); clearFilters(); }}
          />


          {/* Active filter chips — Takealot-style dismissible pills */}
          {activeChips.length > 0 && (
            <div
              className="flex flex-wrap items-center gap-2 mb-5"
              role="region"
              aria-label={`Active filters, ${activeChips.length}`}
            >
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mr-1" aria-hidden="true">Filters:</span>
              {activeChips.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={c.clear}
                  aria-label={c.ariaLabel}
                  className="inline-flex items-center gap-1.5 pl-3 pr-2 py-1 rounded-full bg-primary/[0.08] text-primary text-xs font-medium hover:bg-primary/[0.14] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-colors"
                >
                  <span>{c.label}</span>
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              ))}
              <button
                type="button"
                onClick={() => { setSearchInput(""); setQuery(""); clearFilters(); }}
                className="text-xs text-muted-foreground hover:text-foreground underline ml-1"
              >
                Clear all
              </button>
            </div>
          )}

          {/* Grid */}
          {loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {[...Array(12)].map((_, i) => (
                <div key={i} className="card-flat overflow-hidden animate-pulse">
                  <div className="aspect-square bg-muted" />
                  <div className="p-4 space-y-3">
                    <div className="h-3 bg-muted rounded w-1/4" />
                    <div className="h-4 bg-muted rounded w-3/4" />
                    <div className="h-3 bg-muted rounded w-full" />
                  </div>
                </div>
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="text-center py-20 card-flat">
              <Package className="h-14 w-14 text-muted-foreground/60 mx-auto mb-4" />
              <p className="text-muted-foreground font-display font-semibold text-lg mb-1">No products found</p>
              <p className="text-sm text-muted-foreground mb-4">
                Try adjusting your filters or search terms.
              </p>
              {(query || activeFilters > 0) && (
                <button
                  onClick={() => { setSearchInput(""); setQuery(""); clearFilters(); }}
                  className="btn-secondary px-5 py-2.5 text-sm"
                >
                  Reset all
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {rows.map((p) => <ProductCard key={p.id} product={p} />)}
              </div>


              {/* Pagination */}
              {totalPages > 1 && (
                <nav className="flex items-center justify-center gap-2 mt-10" aria-label="Pagination">
                  <button
                    onClick={() => onPageChange(Math.max(0, page - 1))}
                    disabled={page === 0}
                    className="btn-ghost px-3 py-2 text-sm disabled:opacity-40"
                  >
                    <ChevronLeft className="h-4 w-4" /> Previous
                  </button>
                  {pageNumbers[0] > 0 && (
                    <>
                      <button onClick={() => onPageChange(0)} className="btn-ghost px-3 py-2 text-sm">1</button>
                      {pageNumbers[0] > 1 && <span className="px-2 text-muted-foreground">…</span>}
                    </>
                  )}
                  {pageNumbers.map((n) => (
                    <button
                      key={n}
                      onClick={() => onPageChange(n)}
                      aria-current={n === page ? "page" : undefined}
                      className={`px-3 py-2 text-sm rounded-lg font-semibold ${
                        n === page ? "gradient-brand text-white" : "hover:bg-muted"
                      }`}
                    >
                      {n + 1}
                    </button>
                  ))}
                  {pageNumbers[pageNumbers.length - 1] < totalPages - 1 && (
                    <>
                      {pageNumbers[pageNumbers.length - 1] < totalPages - 2 && <span className="px-2 text-muted-foreground">…</span>}
                      <button onClick={() => onPageChange(totalPages - 1)} className="btn-ghost px-3 py-2 text-sm">{totalPages}</button>
                    </>
                  )}
                  <button
                    onClick={() => onPageChange(Math.min(totalPages - 1, page + 1))}
                    disabled={page >= totalPages - 1}
                    className="btn-ghost px-3 py-2 text-sm disabled:opacity-40"
                  >
                    Next <ChevronRight className="h-4 w-4" />
                  </button>
                </nav>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default Products;
