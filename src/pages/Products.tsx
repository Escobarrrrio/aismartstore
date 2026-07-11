import { useEffect, useMemo, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import ProductCard from "@/components/ProductCard";
import SEO from "@/components/SEO";
import { Package, Search, SlidersHorizontal, X, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import type { Product } from "@/contexts/CartContext";
import { supabase } from "@/integrations/supabase/client";
import { useTranslation } from "react-i18next";
import { formatMoney } from "@/lib/currency";

type SortOption = "relevance" | "price_asc" | "price_desc" | "newest";

const PAGE_SIZE = 24;

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

  // Keep URL ?q= in sync when the header search updates it
  useEffect(() => {
    setSearchInput(urlQ);
    setQuery(urlQ);
    setPage(0);
  }, [urlQ]);

  // Load facets once via RPC (covers full 142k-product catalog)
  useEffect(() => {
    if (facetCache) return;
    (async () => {
      const { data, error } = await supabase.rpc("get_product_facets");
      if (error || !data) return;
      const categories: FacetOption[] = [];
      const brands: FacetOption[] = [];
      for (const row of data as Array<{ facet_type: string; facet_value: string; product_count: number | string }>) {
        const opt = { value: row.facet_value, count: Number(row.product_count) };
        if (row.facet_type === "category") categories.push(opt);
        else if (row.facet_type === "brand") brands.push(opt);
      }
      facetCache = { categories, brands };
      setFacets(facetCache);
    })();
  }, []);

  const runSearch = useCallback(async () => {
    setLoading(true);
    const min = minPrice ? Number(minPrice) : null;
    const max = maxPrice ? Number(maxPrice) : null;
    const { data, error } = await supabase.rpc("search_products", {
      search_query: query,
      filter_category: category || null,
      filter_brand: brand || null,
      filter_ai_only: aiOnly,
      filter_in_stock_only: inStockOnly,
      min_price: min,
      max_price: max,
      sort_by: sort,
      page_number: page,
      page_size: PAGE_SIZE,
    });
    if (error) {
      setRows([]);
      setTotal(0);
    } else {
      const list = (data as Row[]) || [];
      setRows(list.map(toProduct));
      setTotal(list[0]?.total_count ? Number(list[0].total_count) : list.length);
    }
    setLoading(false);
  }, [query, category, brand, aiOnly, inStockOnly, minPrice, maxPrice, sort, page]);

  useEffect(() => { runSearch(); }, [runSearch]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const activeFilters = [category, brand, aiOnly ? "ai" : "", inStockOnly ? "stock" : "", minPrice, maxPrice].filter(Boolean).length;

  const applySearch = (e?: React.FormEvent) => {
    e?.preventDefault();
    const q = searchInput.trim();
    setQuery(q);
    setPage(0);
    if (q) setSearchParams({ q }); else setSearchParams({});
  };

  const clearFilters = () => {
    setCategory(""); setBrand(""); setAiOnly(false); setInStockOnly(false);
    setMinPrice(""); setMaxPrice(""); setPage(0);
  };

  const pageNumbers = useMemo(() => {
    const nums: number[] = [];
    const window = 2;
    const start = Math.max(0, page - window);
    const end = Math.min(totalPages - 1, page + window);
    for (let i = start; i <= end; i++) nums.push(i);
    return nums;
  }, [page, totalPages]);

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
              <select value={category} onChange={(e) => { setCategory(e.target.value); setPage(0); }} className="input-premium">
                <option value="">All categories</option>
                {facets.categories.map((c) => <option key={c.value} value={c.value}>{c.value} ({fmtCount(c.count)})</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Brand</label>
              <select value={brand} onChange={(e) => { setBrand(e.target.value); setPage(0); }} className="input-premium">
                <option value="">All brands</option>
                {facets.brands.map((b) => <option key={b.value} value={b.value}>{b.value} ({fmtCount(b.count)})</option>)}
              </select>
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
            {activeFilters > 0 && (
              <button onClick={clearFilters} className="btn-ghost w-full px-3 py-2 text-sm">
                Clear filters ({activeFilters})
              </button>
            )}
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

          {/* Mobile filter sheet */}
          {showFilters && (
            <div className="lg:hidden card-flat p-5 mb-6 space-y-4 animate-fade-in">
              <select value={category} onChange={(e) => { setCategory(e.target.value); setPage(0); }} className="input-premium">
                <option value="">All categories</option>
                {facets.categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={brand} onChange={(e) => { setBrand(e.target.value); setPage(0); }} className="input-premium">
                <option value="">All brands</option>
                {facets.brands.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
              <div className="flex gap-2">
                <input type="number" placeholder="Min R" value={minPrice} onChange={(e) => { setMinPrice(e.target.value); setPage(0); }} className="input-premium" />
                <input type="number" placeholder="Max R" value={maxPrice} onChange={(e) => { setMaxPrice(e.target.value); setPage(0); }} className="input-premium" />
              </div>
              <label className="flex items-center gap-3 text-sm">
                <input type="checkbox" checked={aiOnly} onChange={(e) => { setAiOnly(e.target.checked); setPage(0); }} className="w-4 h-4 accent-primary" /> AI products only
              </label>
              <label className="flex items-center gap-3 text-sm">
                <input type="checkbox" checked={inStockOnly} onChange={(e) => { setInStockOnly(e.target.checked); setPage(0); }} className="w-4 h-4 accent-primary" /> In stock only
              </label>
              {activeFilters > 0 && (
                <button onClick={clearFilters} className="btn-ghost w-full px-3 py-2 text-sm">Clear filters</button>
              )}
            </div>
          )}

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
