import { useProducts } from "@/contexts/ProductContext";
import ProductCard from "@/components/ProductCard";
import { Package, Search, SlidersHorizontal, X, ChevronDown } from "lucide-react";
import { useState, useMemo } from "react";
import { Product } from "@/contexts/CartContext";
import { useTranslation } from "react-i18next";

type SortOption = "newest" | "price-asc" | "price-desc" | "name";

const Products = () => {
  const { t } = useTranslation();
  const { products, loading } = useProducts();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [stockFilter, setStockFilter] = useState<"all" | "in_stock" | "out_of_stock">("all");
  const [sort, setSort] = useState<SortOption>("newest");
  const [showFilters, setShowFilters] = useState(false);
  const [quickView, setQuickView] = useState<Product | null>(null);

  const categories = useMemo(() => {
    const cats = new Set(products.map((p) => p.category).filter(Boolean));
    return Array.from(cats).sort();
  }, [products]);

  const filtered = useMemo(() => {
    let result = [...products];

    if (search) {
      const q = search.toLowerCase();
      result = result.filter((p) =>
        p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q) || p.category.toLowerCase().includes(q)
      );
    }
    if (category) result = result.filter((p) => p.category === category);
    if (stockFilter === "in_stock") result = result.filter((p) => p.inStock);
    if (stockFilter === "out_of_stock") result = result.filter((p) => !p.inStock);

    switch (sort) {
      case "price-asc": result.sort((a, b) => a.price - b.price); break;
      case "price-desc": result.sort((a, b) => b.price - a.price); break;
      case "name": result.sort((a, b) => a.name.localeCompare(b.name)); break;
      default: break;
    }

    return result;
  }, [products, search, category, stockFilter, sort]);

  const activeFilters = [category, stockFilter !== "all" ? stockFilter : ""].filter(Boolean).length;

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="bg-muted/50 border-b border-border">
        <div className="container mx-auto px-4 py-8 md:py-12">
          <h1 className="text-3xl md:text-4xl font-display font-extrabold tracking-tight mb-2">{t("products.title")}</h1>
          <p className="text-muted-foreground">
            {filtered.length === 1 ? t("products.countSingular", { count: filtered.length }) : t("products.countPlural", { count: filtered.length })}
          </p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-6">
        {/* Search & Controls */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("products.searchPlaceholder")}
              className="input-premium pl-10"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`btn-secondary px-4 py-3 text-sm ${showFilters ? 'border-primary bg-primary/[0.04]' : ''}`}
            >
              <SlidersHorizontal className="h-4 w-4" />
              {t("products.filters")}
              {activeFilters > 0 && (
                <span className="ml-1 w-5 h-5 rounded-full gradient-brand text-white text-xs flex items-center justify-center">{activeFilters}</span>
              )}
            </button>
            <div className="relative">
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortOption)}
                className="input-premium pr-10 appearance-none cursor-pointer min-w-[160px]"
              >
                <option value="newest">{t("products.sortNewest")}</option>
                <option value="price-asc">{t("products.sortPriceAsc")}</option>
                <option value="price-desc">{t("products.sortPriceDesc")}</option>
                <option value="name">{t("products.sortName")}</option>
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            </div>
          </div>
        </div>

        {/* Filter panel */}
        {showFilters && (
          <div className="card-flat p-5 mb-6 animate-fade-in">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t("products.category")}</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="input-premium"
                >
                  <option value="">{t("products.allCategories")}</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t("products.stockStatus")}</label>
                <select
                  value={stockFilter}
                  onChange={(e) => setStockFilter(e.target.value as any)}
                  className="input-premium"
                >
                  <option value="all">{t("products.all")}</option>
                  <option value="in_stock">{t("products.inStock")}</option>
                  <option value="out_of_stock">{t("products.outOfStock")}</option>
                </select>
              </div>
              <div className="flex items-end">
                <button
                  onClick={() => { setCategory(""); setStockFilter("all"); setSearch(""); }}
                  className="btn-ghost px-4 py-3 text-sm w-full"
                >
                  {t("products.clearAllFilters")}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Product grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {[...Array(8)].map((_, i) => (
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
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 card-flat">
            <Package className="h-14 w-14 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-muted-foreground font-display font-semibold text-lg mb-1">
              {search || category ? t("products.noMatch") : t("products.noneYet")}
            </p>
            <p className="text-sm text-muted-foreground mb-4">
              {search || category ? t("products.tryAdjusting") : t("products.willAppear")}
            </p>
            {(search || category) && (
              <button
                onClick={() => { setSearch(""); setCategory(""); setStockFilter("all"); }}
                className="btn-secondary px-5 py-2.5 text-sm"
              >
                {t("products.clearFilters")}
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {filtered.map((product) => (
              <ProductCard key={product.id} product={product} onQuickView={setQuickView} />
            ))}
          </div>
        )}
      </div>

      {/* Quick View Modal */}
      {quickView && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-foreground/50 backdrop-blur-sm" onClick={() => setQuickView(null)} />
          <div className="relative bg-background rounded-2xl shadow-xl max-w-lg w-full p-6 animate-fade-in max-h-[80vh] overflow-y-auto">
            <button
              onClick={() => setQuickView(null)}
              className="absolute top-4 right-4 p-2 rounded-lg hover:bg-muted text-muted-foreground"
            >
              <X className="h-5 w-5" />
            </button>
            {quickView.images[0] && (
              <img src={quickView.images[0]} alt={quickView.name} className="w-full aspect-video object-cover rounded-xl mb-4" />
            )}
            <span className="text-xs font-semibold text-primary uppercase tracking-wider">{quickView.category}</span>
            <h2 className="font-display font-bold text-xl mt-1 mb-2">{quickView.name}</h2>
            <p className="text-2xl font-display font-extrabold gradient-brand-text mb-3">
              R{quickView.price.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
            </p>
            <p className="text-sm text-muted-foreground mb-4 leading-relaxed">{quickView.description}</p>
            <div className="flex gap-3">
              <a href={`/product/${quickView.id}`} className="btn-secondary px-5 py-2.5 text-sm flex-1 text-center">
                {t("products.viewDetails")}
              </a>
              <button
                onClick={() => { setQuickView(null); }}
                className="btn-primary px-5 py-2.5 text-sm flex-1"
              >
                {t("products.addToCart")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Products;
