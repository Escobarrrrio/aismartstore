import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Search, SlidersHorizontal, X, RefreshCw } from "lucide-react";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type FacetOption = { value: string; count: number };
type SortOption = "relevance" | "price_asc" | "price_desc" | "newest";

interface MobileFilterSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: FacetOption[];
  brands: FacetOption[];
  facetsLoading: boolean;
  facetsError: boolean;
  onRetryFacets: () => void;

  category: string;
  brand: string;
  minPrice: string;
  maxPrice: string;
  aiOnly: boolean;
  inStockOnly: boolean;
  sort: SortOption;

  setCategory: (v: string) => void;
  setBrand: (v: string) => void;
  setMinPrice: (v: string) => void;
  setMaxPrice: (v: string) => void;
  setAiOnly: (v: boolean) => void;
  setInStockOnly: (v: boolean) => void;
  setSort: (v: SortOption) => void;

  resultCount: number;
  activeFilters: number;
  onClearAll: () => void;
}

const fmtCount = (n: number) => n.toLocaleString("en-ZA").replace(/,/g, " ");

/**
 * Accessible bottom-sheet filter panel for mobile.
 * - Radix/vaul-backed Drawer: focus trap, ESC to close, restore focus on close.
 * - Live search inside each facet list.
 * - Skeleton while facets load, retry banner on error, preserves current
 *   selection even when it's missing from the options list.
 * - Sticky footer with reset + "Show N results" primary action.
 */
export default function MobileFilterSheet(props: MobileFilterSheetProps) {
  const {
    open, onOpenChange,
    categories, brands, facetsLoading, facetsError, onRetryFacets,
    category, brand, minPrice, maxPrice, aiOnly, inStockOnly, sort,
    setCategory, setBrand, setMinPrice, setMaxPrice, setAiOnly, setInStockOnly, setSort,
    resultCount, activeFilters, onClearAll,
  } = props;

  const [tab, setTab] = useState<"category" | "brand" | "more">("category");
  const [catQuery, setCatQuery] = useState("");
  const [brandQuery, setBrandQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // Reset the local search whenever the sheet closes so it opens clean next time.
  useEffect(() => {
    if (!open) {
      setCatQuery("");
      setBrandQuery("");
      setTab("category");
    }
  }, [open]);

  // Autofocus the search when switching to a facet tab (mobile users expect it).
  useEffect(() => {
    if (!open) return;
    if (tab === "category" || tab === "brand") {
      const t = setTimeout(() => searchRef.current?.focus({ preventScroll: true }), 60);
      return () => clearTimeout(t);
    }
  }, [tab, open]);

  const filter = (opts: FacetOption[], q: string, current: string) => {
    const needle = q.trim().toLowerCase();
    const filtered = needle
      ? opts.filter((o) => o.value.toLowerCase().includes(needle))
      : opts.slice();
    // Pin the currently-selected value to the top if it isn't shown.
    if (current && !filtered.some((o) => o.value === current)) {
      filtered.unshift({ value: current, count: 0 });
    }
    return filtered;
  };

  const filteredCats = useMemo(() => filter(categories, catQuery, category), [categories, catQuery, category]);
  const filteredBrands = useMemo(() => filter(brands, brandQuery, brand), [brands, brandQuery, brand]);

  const renderFacetList = (
    kind: "category" | "brand",
    opts: FacetOption[],
    selected: string,
    onSelect: (v: string) => void,
  ) => {
    if (facetsLoading && opts.length === 0) {
      return (
        <ul role="status" aria-label={`Loading ${kind} options`} className="space-y-1.5 px-1">
          {[...Array(8)].map((_, i) => (
            <li key={i} className="h-11 rounded-lg bg-muted animate-pulse" />
          ))}
        </ul>
      );
    }
    if (facetsError && opts.length === 0) {
      return (
        <div className="mx-1 rounded-lg border border-dashed border-border p-6 text-center">
          <p className="text-sm text-muted-foreground mb-3">
            {kind === "category" ? "Categories" : "Brands"} couldn't load.
          </p>
          <button
            type="button"
            onClick={onRetryFacets}
            className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline min-h-11 px-3"
          >
            <RefreshCw className="h-4 w-4" /> Retry
          </button>
        </div>
      );
    }
    if (opts.length === 0) {
      return (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          No matches. Try a different search.
        </p>
      );
    }
    return (
      <ul role="radiogroup" aria-label={kind} className="space-y-1 px-1">
        <li>
          <button
            type="button"
            role="radio"
            aria-checked={selected === ""}
            onClick={() => onSelect("")}
            className={`w-full min-h-11 flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
              selected === "" ? "bg-primary/[0.08] text-foreground font-semibold" : "hover:bg-muted"
            }`}
          >
            <span>All {kind === "category" ? "categories" : "brands"}</span>
            {selected === "" && <Check className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />}
          </button>
        </li>
        {opts.map((o) => {
          const isSelected = o.value === selected;
          return (
            <li key={o.value}>
              <button
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => onSelect(o.value)}
                className={`w-full min-h-11 flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                  isSelected ? "bg-primary/[0.08] text-foreground font-semibold" : "hover:bg-muted"
                }`}
              >
                <span className="truncate">{o.value}</span>
                <span className="flex items-center gap-2 shrink-0">
                  {o.count > 0 && (
                    <span className="text-xs tabular-nums text-muted-foreground">{fmtCount(o.count)}</span>
                  )}
                  {isSelected && <Check className="h-4 w-4 text-primary" aria-hidden="true" />}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="lg:hidden h-[92dvh] max-h-[92dvh] focus:outline-none">
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-2 pb-3 border-b border-border">
          <div className="flex items-center gap-2 min-w-0">
            <SlidersHorizontal className="h-5 w-5 text-muted-foreground shrink-0" aria-hidden="true" />
            <DrawerTitle className="text-base font-display font-semibold truncate">
              Filters
            </DrawerTitle>
            {activeFilters > 0 && (
              <span
                className="ml-1 min-w-6 h-6 px-2 rounded-full gradient-brand text-white text-xs font-semibold flex items-center justify-center"
                aria-label={`${activeFilters} filters active`}
              >
                {activeFilters}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onClearAll}
              disabled={activeFilters === 0}
              className="min-h-11 px-3 text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Clear all
            </button>
            <DrawerClose asChild>
              <button
                type="button"
                aria-label="Close filters"
                className="min-h-11 min-w-11 flex items-center justify-center rounded-lg hover:bg-muted"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </DrawerClose>
          </div>
        </div>
        <DrawerDescription className="sr-only">
          Refine products by category, brand, price and availability.
        </DrawerDescription>

        {/* Tabs */}
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="flex-1 flex flex-col min-h-0">
          <TabsList className="mx-4 mt-3 grid grid-cols-3">
            <TabsTrigger value="category" className="text-xs">
              Category{category && <span className="ml-1 h-1.5 w-1.5 rounded-full bg-primary inline-block" aria-hidden="true" />}
            </TabsTrigger>
            <TabsTrigger value="brand" className="text-xs">
              Brand{brand && <span className="ml-1 h-1.5 w-1.5 rounded-full bg-primary inline-block" aria-hidden="true" />}
            </TabsTrigger>
            <TabsTrigger value="more" className="text-xs">
              More{(minPrice || maxPrice || aiOnly || inStockOnly) && (
                <span className="ml-1 h-1.5 w-1.5 rounded-full bg-primary inline-block" aria-hidden="true" />
              )}
            </TabsTrigger>
          </TabsList>

          {/* Category */}
          <TabsContent value="category" className="flex-1 min-h-0 flex flex-col mt-3 mx-0">
            <div className="px-4 pb-3">
              <label htmlFor="cat-search" className="sr-only">Search categories</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <input
                  id="cat-search"
                  ref={tab === "category" ? searchRef : undefined}
                  type="search"
                  value={catQuery}
                  onChange={(e) => setCatQuery(e.target.value)}
                  placeholder="Search categories…"
                  autoComplete="off"
                  className="input-premium pl-10 pr-10"
                />
                {catQuery && (
                  <button
                    type="button"
                    onClick={() => setCatQuery("")}
                    aria-label="Clear category search"
                    className="absolute right-2 top-1/2 -translate-y-1/2 min-h-9 min-w-9 flex items-center justify-center text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto overscroll-contain px-3 pb-2">
              {renderFacetList("category", filteredCats, category, setCategory)}
            </div>
          </TabsContent>

          {/* Brand */}
          <TabsContent value="brand" className="flex-1 min-h-0 flex flex-col mt-3 mx-0">
            <div className="px-4 pb-3">
              <label htmlFor="brand-search" className="sr-only">Search brands</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <input
                  id="brand-search"
                  ref={tab === "brand" ? searchRef : undefined}
                  type="search"
                  value={brandQuery}
                  onChange={(e) => setBrandQuery(e.target.value)}
                  placeholder="Search brands…"
                  autoComplete="off"
                  className="input-premium pl-10 pr-10"
                />
                {brandQuery && (
                  <button
                    type="button"
                    onClick={() => setBrandQuery("")}
                    aria-label="Clear brand search"
                    className="absolute right-2 top-1/2 -translate-y-1/2 min-h-9 min-w-9 flex items-center justify-center text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto overscroll-contain px-3 pb-2">
              {renderFacetList("brand", filteredBrands, brand, setBrand)}
            </div>
          </TabsContent>

          {/* More: price, toggles, sort */}
          <TabsContent value="more" className="flex-1 min-h-0 overflow-y-auto mt-3 mx-0 px-4 space-y-6 pb-4">
            <fieldset>
              <legend className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Price (ZAR)
              </legend>
              <div className="flex gap-2">
                <label className="flex-1">
                  <span className="sr-only">Minimum price</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min="0"
                    placeholder="Min"
                    value={minPrice}
                    onChange={(e) => setMinPrice(e.target.value)}
                    className="input-premium"
                  />
                </label>
                <label className="flex-1">
                  <span className="sr-only">Maximum price</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min="0"
                    placeholder="Max"
                    value={maxPrice}
                    onChange={(e) => setMaxPrice(e.target.value)}
                    className="input-premium"
                  />
                </label>
              </div>
            </fieldset>

            <fieldset className="space-y-1">
              <legend className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Availability
              </legend>
              <label className="flex items-center justify-between min-h-12 gap-3 rounded-lg px-3 -mx-3 hover:bg-muted cursor-pointer">
                <span className="text-sm">AI products only</span>
                <input
                  type="checkbox"
                  checked={aiOnly}
                  onChange={(e) => setAiOnly(e.target.checked)}
                  className="w-5 h-5 accent-primary"
                />
              </label>
              <label className="flex items-center justify-between min-h-12 gap-3 rounded-lg px-3 -mx-3 hover:bg-muted cursor-pointer">
                <span className="text-sm">In stock only</span>
                <input
                  type="checkbox"
                  checked={inStockOnly}
                  onChange={(e) => setInStockOnly(e.target.checked)}
                  className="w-5 h-5 accent-primary"
                />
              </label>
            </fieldset>

            <fieldset>
              <legend className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Sort by
              </legend>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Sort by">
                {([
                  ["relevance", "Relevance"],
                  ["price_asc", "Price: low to high"],
                  ["price_desc", "Price: high to low"],
                  ["newest", "Newest"],
                ] as const).map(([v, label]) => {
                  const isSel = sort === v;
                  return (
                    <button
                      key={v}
                      type="button"
                      role="radio"
                      aria-checked={isSel}
                      onClick={() => setSort(v)}
                      className={`min-h-11 rounded-lg border text-sm px-3 text-left ${
                        isSel
                          ? "border-primary bg-primary/[0.06] font-semibold text-foreground"
                          : "border-border hover:bg-muted"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          </TabsContent>
        </Tabs>

        {/* Sticky footer */}
        <div
          className="border-t border-border bg-background/95 backdrop-blur px-4 py-3 flex gap-2"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        >
          <button
            type="button"
            onClick={onClearAll}
            disabled={activeFilters === 0}
            className="btn-secondary min-h-12 px-4 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Reset
          </button>
          <DrawerClose asChild>
            <button
              type="button"
              className="gradient-brand text-white font-semibold flex-1 min-h-12 rounded-lg px-4 text-sm"
            >
              Show {resultCount.toLocaleString("en-ZA")} result{resultCount === 1 ? "" : "s"}
            </button>
          </DrawerClose>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
