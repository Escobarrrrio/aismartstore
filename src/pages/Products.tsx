import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import ProductCard from "@/components/ProductCard";
import MobileFilterSheet from "@/components/products/MobileFilterSheet";
import SEO from "@/components/SEO";
import { Package, Search, SlidersHorizontal, X, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import type { Product } from "@/contexts/CartContext";
import { supabase } from "@/integrations/supabase/client";
import { useTranslation } from "react-i18next";
import { formatMoney } from "@/lib/currency";

type SortOption = "relevance" | "price_asc" | "price_desc" | "newest";

const PAGE_SIZE = 24;
// Enterprise / procurement-tier items (workstations, GPUs, rack gear) live on
// the /procurement page. The consumer catalogue defaults to items priced below
// this threshold; users can opt in via the "Include business items" toggle.
const BUSINESS_PRICE_THRESHOLD = 15000;

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

// Simple module-level cache for distinct categories/brands.
type FacetOption = { value: string; count: number };
let facetCache: { categories: FacetOption[]; brands: FacetOption[] } | null = null;

const fmtCount = (n: number) => n.toLocaleString("en-ZA").replace(/,/g, " ");

const Products = () => {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();

  const urlQ = searchParams.get("q") || "";
  const [searchInput, setSearchInput] = useState(urlQ);
  const [query, setQuery] = useState(urlQ);
  const [category, setCategory] = useState("");
  const [brand, setBrand] = useState("");
  const [aiOnly, setAiOnly] = useState(false);
  const [inStockOnly, setInStockOnly] = useState(false);
  // Default: hide enterprise/procurement-tier items — those belong on /procurement.
  const [includeBusiness, setIncludeBusiness] = useState(false);
  const [minPrice, setMinPrice] = useState<string>("");
  const [maxPrice, setMaxPrice] = useState<string>("");
  const [sort, setSort] = useState<SortOption>("relevance");
  const [page, setPage] = useState(0);
  const [showFilters, setShowFilters] = useState(false);

  const [rows, setRows] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [facets, setFacets] = useState<{ categories: FacetOption[]; brands: FacetOption[] }>(
    facetCache || { categories: [], brands: [] }
  );
  const [facetsLoading, setFacetsLoading] = useState(!facetCache);
  const [facetsError, setFacetsError] = useState(false);

  // Keep URL ?q= in sync when the header search updates it
  useEffect(() => {
    setSearchInput(urlQ);
    setQuery(urlQ);
    setPage(0);
  }, [urlQ]);

  // Load facets via cached RPC. Falls back to (1) the cache table, then (2) a
  // lightweight distinct query on products, so the dropdowns are never empty.
  useEffect(() => {
    let cancelled = false;

    const setFromRows = (rows: Array<{ facet_type: string; facet_value: string; product_count: number | string }>) => {
      const categories: FacetOption[] = [];
      const brands: FacetOption[] = [];
      for (const r of rows) {
        if (!r?.facet_value) continue;
        const opt = { value: r.facet_value, count: Number(r.product_count) || 0 };
        if (r.facet_type === "category") categories.push(opt);
        else if (r.facet_type === "brand") brands.push(opt);
      }
      categories.sort((a, b) => b.count - a.count);
      brands.sort((a, b) => b.count - a.count);
      facetCache = { categories, brands };
      setFacets(facetCache);
      setFacetsError(false);
    };

    const load = async (attempt = 0): Promise<void> => {
      try {
        // 1) Fast cached RPC.
        const { data, error } = await supabase.rpc("get_product_facets");
        if (cancelled) return;
        if (!error && Array.isArray(data) && data.length > 0) {
          setFromRows(data as any);
          setFacetsLoading(false);
          return;
        }
        // 2) Direct cache table read.
        const { data: cacheRows, error: cacheErr } = await supabase
          .from("product_facets_cache")
          .select("facet_type, facet_value, product_count")
          .order("product_count", { ascending: false });
        if (cancelled) return;
        if (!cacheErr && cacheRows && cacheRows.length > 0) {
          setFromRows(cacheRows as any);
          setFacetsLoading(false);
          return;
        }
        // 3) Distinct sample from products so dropdowns still have something.
        const { data: sampleRows } = await supabase
          .from("products")
          .select("category, brand")
          .eq("is_active", true)
          .not("category", "is", null)
          .limit(500);
        if (cancelled) return;
        if (sampleRows && sampleRows.length > 0) {
          const catMap = new Map<string, number>();
          const brandMap = new Map<string, number>();
          for (const r of sampleRows as Array<{ category: string | null; brand: string | null }>) {
            if (r.category) catMap.set(r.category, (catMap.get(r.category) || 0) + 1);
            if (r.brand) brandMap.set(r.brand, (brandMap.get(r.brand) || 0) + 1);
          }
          const toOpts = (m: Map<string, number>) =>
            Array.from(m.entries())
              .map(([value, count]) => ({ value, count }))
              .sort((a, b) => b.count - a.count);
          facetCache = { categories: toOpts(catMap), brands: toOpts(brandMap) };
          setFacets(facetCache);
          setFacetsError(false);
          setFacetsLoading(false);
          return;
        }
        // Retry once for transient issues.
        if (attempt < 1) {
          await new Promise((r) => setTimeout(r, 800));
          if (!cancelled) return load(attempt + 1);
        }
        if (!cancelled) {
          setFacetsError(true);
          setFacetsLoading(false);
        }
      } catch {
        if (!cancelled) {
          setFacetsError(true);
          setFacetsLoading(false);
        }
      }
    };

    if (facetCache) {
      setFacets(facetCache);
      setFacetsLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, []);



  // Intelligent prefetch cache keyed by the exact RPC args (search + filters +
  // page). When the user changes filters, we hit the network for the current
  // page and, in the background, warm the *next* page so pagination clicks feel
  // instant. Cache is bounded to keep memory tiny (last 12 pages).
  type PageCache = { rows: Product[]; total: number };
  const prefetchCache = useRef<Map<string, PageCache>>(new Map());
  const inflightPrefetch = useRef<Set<string>>(new Set());

  const buildRpcArgs = useCallback((pageIndex: number) => {
    const min = minPrice ? Number(minPrice) : null;
    let max = maxPrice ? Number(maxPrice) : null;
    // Consumer catalogue: cap price unless the user opts into business items,
    // or explicitly sets a higher max. Keeps enterprise SKUs on /procurement.
    if (!includeBusiness) {
      max = max !== null ? Math.min(max, BUSINESS_PRICE_THRESHOLD) : BUSINESS_PRICE_THRESHOLD;
    }
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
    };
  }, [query, category, brand, aiOnly, inStockOnly, includeBusiness, minPrice, maxPrice, sort]);

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
  }, [page, buildRpcArgs, cacheKey, prefetchPage]);

  useEffect(() => { runSearch(); }, [runSearch]);

  // Invalidate the prefetch cache whenever filters/query change so we never
  // show stale pages after a filter switch.
  useEffect(() => {
    prefetchCache.current.clear();
    inflightPrefetch.current.clear();
  }, [query, category, brand, aiOnly, inStockOnly, includeBusiness, minPrice, maxPrice, sort]);


  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const activeFilters = [category, brand, aiOnly ? "ai" : "", inStockOnly ? "stock" : "", includeBusiness ? "biz" : "", minPrice, maxPrice].filter(Boolean).length;

  const applySearch = (e?: React.FormEvent) => {
    e?.preventDefault();
    const q = searchInput.trim();
    setQuery(q);
    setPage(0);
    if (q) setSearchParams({ q }); else setSearchParams({});
  };

  const clearFilters = () => {
    setCategory(""); setBrand(""); setAiOnly(false); setInStockOnly(false);
    setIncludeBusiness(false); setMinPrice(""); setMaxPrice(""); setPage(0);
  };

  const pageNumbers = useMemo(() => {
    const nums: number[] = [];
    const window = 2;
    const start = Math.max(0, page - window);
    const end = Math.min(totalPages - 1, page + window);
    for (let i = start; i <= end; i++) nums.push(i);
    return nums;
  }, [page, totalPages]);

  // Renders a facet <select> with skeleton, error fallback, and empty states so
  // the dropdowns are always meaningful even if RPC + cache both fail.
  const renderFacetSelect = (
    kind: "category" | "brand",
    value: string,
    onChange: (v: string) => void,
  ) => {
    const options = kind === "category" ? facets.categories : facets.brands;
    const allLabel = kind === "category" ? "All categories" : "All brands";
    if (facetsLoading && options.length === 0) {
      return (
        <div
          role="status"
          aria-label={`Loading ${kind} options`}
          className="h-11 w-full rounded-lg bg-muted animate-pulse"
        />
      );
    }
    return (
      <div className="space-y-1.5">
        <select
          value={value}
          onChange={(e) => { onChange(e.target.value); setPage(0); }}
          className="input-premium"
          aria-invalid={facetsError && options.length === 0 ? true : undefined}
        >
          <option value="">{allLabel}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.value}{o.count ? ` (${fmtCount(o.count)})` : ""}
            </option>
          ))}
          {value && !options.some((o) => o.value === value) && (
            <option value={value}>{value}</option>
          )}
        </select>
        {facetsError && options.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Filter options couldn’t load.{" "}
            <button
              type="button"
              onClick={() => { facetCache = null; setFacetsLoading(true); setFacetsError(false); location.reload(); }}
              className="underline hover:text-foreground"
            >
              Retry
            </button>
          </p>
        )}
      </div>
    );
  };


  return (
    <div className="min-h-screen">
      <SEO
        title={query ? `${query} — ${t("products.title")}` : t("products.title")}
        description="Browse AI hardware, networking equipment, computing, and enterprise software at AI Smart Store."
        path="/products"
      />

      {/* Header */}
      <div className="bg-muted/50 border-b border-border">
        <div className="container mx-auto px-4 py-8 md:py-12">
          <h1 className="text-3xl md:text-4xl font-display font-extrabold tracking-tight mb-2">{t("products.title")}</h1>
          <p className="text-muted-foreground">
            {loading
              ? "Searching…"
              : query
                ? `${total.toLocaleString("en-ZA")} results for "${query}"`
                : `${total.toLocaleString("en-ZA")} products`}
          </p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
        {/* Filter sidebar (desktop) */}
        <aside className="hidden lg:block">
          <div className="card-flat p-5 sticky top-24 space-y-5">
            <div>
              <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Category</label>
              {renderFacetSelect("category", category, setCategory)}
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Brand</label>
              {renderFacetSelect("brand", brand, setBrand)}
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Price (ZAR)</label>
              <div className="flex gap-2">
                <input type="number" min="0" placeholder="Min" value={minPrice}
                  onChange={(e) => { setMinPrice(e.target.value); setPage(0); }}
                  className="input-premium" />
                <input type="number" min="0" placeholder="Max" value={maxPrice}
                  onChange={(e) => { setMaxPrice(e.target.value); setPage(0); }}
                  className="input-premium" />
              </div>
            </div>
            <label className="flex items-center gap-3 cursor-pointer text-sm">
              <input type="checkbox" checked={aiOnly} onChange={(e) => { setAiOnly(e.target.checked); setPage(0); }} className="w-4 h-4 accent-primary" />
              AI products only
            </label>
            <label className="flex items-center gap-3 cursor-pointer text-sm">
              <input type="checkbox" checked={inStockOnly} onChange={(e) => { setInStockOnly(e.target.checked); setPage(0); }} className="w-4 h-4 accent-primary" />
              In stock only
            </label>
            <label className="flex items-start gap-3 cursor-pointer text-sm border-t border-border pt-4">
              <input
                type="checkbox"
                checked={includeBusiness}
                onChange={(e) => { setIncludeBusiness(e.target.checked); setPage(0); }}
                className="w-4 h-4 accent-primary mt-0.5"
              />
              <span>
                Include business items
                <span className="block text-xs text-muted-foreground mt-0.5">
                  Enterprise gear ({formatMoney(BUSINESS_PRICE_THRESHOLD)}+) lives on the{" "}
                  <a href="/procurement" className="text-primary hover:underline">procurement</a> page.
                </span>
              </span>
            </label>
            <button
              onClick={() => { setSearchInput(""); setQuery(""); clearFilters(); setSearchParams({}); }}
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
                className="input-premium pl-10"
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={() => { setSearchInput(""); setQuery(""); setPage(0); setSearchParams({}); }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </form>
            <div className="flex gap-2">
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={`btn-secondary px-4 py-3 text-sm lg:hidden ${showFilters ? 'border-primary bg-primary/[0.04]' : ''}`}
              >
                <SlidersHorizontal className="h-4 w-4" />
                Filters
                {activeFilters > 0 && (
                  <span className="ml-1 w-5 h-5 rounded-full gradient-brand text-white text-xs flex items-center justify-center">{activeFilters}</span>
                )}
              </button>
              <div className="relative">
                <select
                  value={sort}
                  onChange={(e) => { setSort(e.target.value as SortOption); setPage(0); }}
                  className="input-premium pr-10 appearance-none cursor-pointer min-w-[180px]"
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
            onRetryFacets={() => { facetCache = null; setFacetsLoading(true); setFacetsError(false); location.reload(); }}
            category={category}
            brand={brand}
            minPrice={minPrice}
            maxPrice={maxPrice}
            aiOnly={aiOnly}
            inStockOnly={inStockOnly}
            sort={sort}
            setCategory={(v) => { setCategory(v); setPage(0); }}
            setBrand={(v) => { setBrand(v); setPage(0); }}
            setMinPrice={(v) => { setMinPrice(v); setPage(0); }}
            setMaxPrice={(v) => { setMaxPrice(v); setPage(0); }}
            setAiOnly={(v) => { setAiOnly(v); setPage(0); }}
            setInStockOnly={(v) => { setInStockOnly(v); setPage(0); }}
            setSort={(v) => { setSort(v); setPage(0); }}
            resultCount={total}
            activeFilters={activeFilters}
            onClearAll={() => { setSearchInput(""); setQuery(""); clearFilters(); setSearchParams({}); }}
          />


          {/* Grid */}
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="card-flat overflow-hidden animate-pulse">
                  <div className="aspect-[4/3] bg-muted" />
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
              <Package className="h-14 w-14 text-muted-foreground/30 mx-auto mb-4" />
              <p className="text-muted-foreground font-display font-semibold text-lg mb-1">No products found</p>
              <p className="text-sm text-muted-foreground mb-4">
                Try adjusting your filters or search terms.
              </p>
              {(query || activeFilters > 0) && (
                <button
                  onClick={() => { setSearchInput(""); setQuery(""); clearFilters(); setSearchParams({}); }}
                  className="btn-secondary px-5 py-2.5 text-sm"
                >
                  Reset all
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {rows.map((p) => <ProductCard key={p.id} product={p} />)}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <nav className="flex items-center justify-center gap-2 mt-10" aria-label="Pagination">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="btn-ghost px-3 py-2 text-sm disabled:opacity-40"
                  >
                    <ChevronLeft className="h-4 w-4" /> Previous
                  </button>
                  {pageNumbers[0] > 0 && (
                    <>
                      <button onClick={() => setPage(0)} className="btn-ghost px-3 py-2 text-sm">1</button>
                      {pageNumbers[0] > 1 && <span className="px-2 text-muted-foreground">…</span>}
                    </>
                  )}
                  {pageNumbers.map((n) => (
                    <button
                      key={n}
                      onClick={() => setPage(n)}
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
                      <button onClick={() => setPage(totalPages - 1)} className="btn-ghost px-3 py-2 text-sm">{totalPages}</button>
                    </>
                  )}
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
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
