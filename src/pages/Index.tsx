import { useProducts } from "@/contexts/ProductContext";
import { useTranslation } from "react-i18next";
import ProductCard from "@/components/ProductCard";
import HeroSection from "@/components/HeroSection";
import SEO from "@/components/SEO";
import { Package, ArrowRight, Cpu, Globe, Server, Code, MessageCircle, Shield, Headphones, BarChart3, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Product } from "@/contexts/CartContext";
import { trackEvent } from "@/lib/analytics";

const Index = () => {
  const { products, loading } = useProducts();
  const { t } = useTranslation();
  const [aiPicks, setAiPicks] = useState<Product[]>([]);
  // AI Picks and Featured both draw from the newest-residential-products
  // pool, so without this exclusion the same items show up in both grids
  // back to back. Featured should showcase what AI Picks isn't already covering.
  const aiPickIds = new Set(aiPicks.map((p) => p.id));
  const featured = products.filter((p) => !aiPickIds.has(p.id)).slice(0, 8);
  const [catalogCount, setCatalogCount] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      // Residential-friendly AI picks: AI-tagged, priced for a household budget
      // (≤ R15,000), image required. Enterprise/high-ticket AI hardware lives
      // in the "For Business" (/procurement) section instead.
      const { data } = await supabase
        .from("products")
        .select("id, name, description, price, category, brand, sku, images, in_stock, stock_quantity, is_ai_product, created_at")
        .eq("is_active", true)
        .eq("audience", "residential")
        .eq("is_ai_product", true)
        .lte("price", 15000)
        .not("images", "is", null)
        .order("created_at", { ascending: false })
        .limit(16);
      setAiPicks(
        ((data as any[]) || [])
          .filter((p) => Array.isArray(p.images) && p.images[0])
          .slice(0, 8)
          .map((p) => ({
            id: p.id,
            name: p.name,
            description: p.description || "",
            price: Number(p.price),
            category: p.category || "",
            brand: p.brand || undefined,
            sku: p.sku || undefined,
            images: p.images || [],
            inStock: p.in_stock,
            stockQuantity: typeof p.stock_quantity === "number" ? p.stock_quantity : undefined,
            isAiProduct: !!p.is_ai_product,
            createdAt: p.created_at || new Date().toISOString(),
          }))
      );

      const { count } = await supabase
        .from("products")
        .select("id", { count: "exact", head: true })
        .eq("is_active", true)
        .eq("audience", "residential");
      if (typeof count === "number") setCatalogCount(count);
    })();
  }, []);

  const categoryCards = [
    { key: "ai", icon: Cpu, color: "bg-primary/[0.06] text-primary", to: "/products?ai=1" },
    { key: "networking", icon: Globe, color: "bg-secondary/[0.06] text-secondary", to: `/products?category=${encodeURIComponent("Networking")}` },
    // No single category cleanly covers "computing" (spans Laptop, Desktops &
    // Workstations, Servers, AIO, Storage, Monitors) -- link to the general
    // catalogue rather than a filter that would hide most of what it promises.
    { key: "computing", icon: Server, color: "bg-[hsl(160,84%,39%)]/[0.06] text-[hsl(160,84%,39%)]", to: "/products" },
    { key: "software", icon: Code, color: "bg-[hsl(38,92%,50%)]/[0.06] text-[hsl(38,92%,50%)]", to: `/products?category=${encodeURIComponent("Software & Licensing")}` },
  ] as const;

  const benefits = [
    { key: "distributor", Icon: Shield },
    { key: "ai", Icon: Headphones },
    { key: "business", Icon: BarChart3 },
  ] as const;

  return (
    <div className="flex flex-col">
      <SEO
        title="AI & Enterprise Hardware in South Africa"
        description="Shop curated AI hardware, networking gear, computing devices, and enterprise software in South Africa. Distributor-backed pricing in ZAR with SA-wide delivery."
        path="/"
        jsonLd={[
          {
            "@context": "https://schema.org",
            "@type": "Organization",
            name: "AI Smart Store",
            url: typeof window !== "undefined" ? window.location.origin : "https://aismartstore.co.za",
            logo: typeof window !== "undefined" ? `${window.location.origin}/icon-512.png` : "https://aismartstore.co.za/icon-512.png",
            description: "South Africa's premium AI & technology store.",
          },
          {
            "@context": "https://schema.org",
            "@type": "WebSite",
            name: "AI Smart Store",
            url: typeof window !== "undefined" ? window.location.origin : "https://aismartstore.co.za",
            potentialAction: {
              "@type": "SearchAction",
              target: `${typeof window !== "undefined" ? window.location.origin : "https://aismartstore.co.za"}/products?q={search_term_string}`,
              "query-input": "required name=search_term_string",
            },
          },
        ]}
      />
      <HeroSection />

      {/* Business / Government portal callout — residential storefront visitors
          who are actually procuring for a company or department get a clear
          one-click path to the right catalogue. */}
      <section className="border-y border-primary/15 bg-primary/[0.04]">
        <div className="container mx-auto px-4 py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <p className="text-sm text-foreground">
            <span className="font-display font-bold">Shopping for your business or government department?</span>{" "}
            <span className="text-muted-foreground">
              Servers, licensing, warranty, networking and the full compliance pack
              live on our Business Portal ({catalogCount !== null ? "" : ""}
              <span className="font-semibold">86,000+ enterprise SKUs</span>).
            </span>
          </p>
          <Link
            to="/procurement"
            className="btn-primary px-5 py-2.5 text-sm whitespace-nowrap"
          >
            Visit Business Portal <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
      {catalogCount !== null && (
        <p className="container mx-auto px-4 pt-6 text-xs text-muted-foreground text-center">
          Currently curating {catalogCount.toLocaleString("en-ZA")}+ residential-friendly products across AI, computing and creator gear.
        </p>
      )}

      {/* AI-Ready Picks — showcase products explicitly flagged as AI-relevant */}
      {aiPicks.length > 0 && (
        <section className="section-padding">
          <div className="container mx-auto px-4">
            <div className="flex items-end justify-between mb-10">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 text-primary px-3 py-1 text-xs font-semibold mb-3">
                  <Sparkles className="h-3.5 w-3.5" />
                  AI for Home
                </div>
                <h2 className="text-3xl md:text-4xl font-display font-extrabold tracking-tight mb-2">
                  <span className="shimmer-text">Everyday AI picks under R15,000</span>
                </h2>
                <p className="text-muted-foreground max-w-xl">
                  AI-ready gear priced for real households — creators, students, remote workers.
                  Enterprise GPUs, servers and rack-scale AI accelerators live on our{" "}
                  <Link to="/procurement" className="font-semibold text-primary hover:underline">For Business</Link>{" "}
                  page. Searching a distributor product code? Just paste it into the search bar — it works site-wide.
                </p>
              </div>
              <Link to="/products?ai=1" className="hidden md:flex items-center gap-2 text-sm font-semibold text-primary hover:underline">
                Browse all AI gear <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {aiPicks.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Categories Section */}
      <section className="section-padding">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-display font-extrabold tracking-tight mb-3">
              <span className="shimmer-text">{t("home.categoriesTitle")}</span>
            </h2>
            <p className="text-muted-foreground max-w-md mx-auto">
              {t("home.categoriesSubtitle")}
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {categoryCards.map((cat) => (
              <Link
                key={cat.key}
                to={cat.to}
                className="card-premium p-6 text-center group"
              >
                <div className={`w-14 h-14 rounded-2xl ${cat.color} flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform duration-300`}>
                  <cat.icon className="h-7 w-7" />
                </div>
                <h3 className="font-display font-bold text-sm mb-1">{t(`home.catShort.${cat.key}.label`)}</h3>
                <p className="text-xs text-muted-foreground">{t(`home.catShort.${cat.key}.count`)}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Featured Products */}
      <section className="section-padding bg-muted/30">
        <div className="container mx-auto px-4">
          <div className="flex items-end justify-between mb-10">
            <div>
              <h2 className="text-3xl md:text-4xl font-display font-extrabold tracking-tight mb-2">
                <span className="shimmer-text">{t("home.featuredTitle")}</span>
              </h2>
              <p className="text-muted-foreground">{t("home.featuredSubtitle")}</p>
            </div>
            <Link to="/products" className="hidden md:flex items-center gap-2 text-sm font-semibold text-primary hover:underline">
              {t("home.viewAll")} <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="card-flat overflow-hidden animate-pulse">
                  <div className="aspect-[4/3] bg-muted" />
                  <div className="p-4 space-y-3">
                    <div className="h-3 bg-muted rounded w-1/4" />
                    <div className="h-4 bg-muted rounded w-3/4" />
                    <div className="h-3 bg-muted rounded w-full" />
                    <div className="flex justify-between items-center pt-2">
                      <div className="h-5 bg-muted rounded w-20" />
                      <div className="h-10 bg-muted rounded-full w-20" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : featured.length === 0 ? (
            <div className="text-center py-20 card-flat">
              <Package className="h-14 w-14 text-muted-foreground/30 mx-auto mb-4" />
              <p className="text-muted-foreground text-lg font-display font-semibold mb-1">{t("home.noProducts")}</p>
              <p className="text-sm text-muted-foreground">
                {t("home.noProductsHint")}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {featured.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          )}

          <div className="md:hidden text-center mt-8">
            <Link to="/products" className="btn-secondary px-6 py-3 text-sm">
              {t("home.viewAllProducts")} <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Benefits Section */}
      <section className="section-padding">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-display font-extrabold tracking-tight mb-3">
              <span className="shimmer-text">{t("home.why.title")}</span>
            </h2>
            <p className="text-muted-foreground max-w-lg mx-auto">
              {t("home.why.subtitle")}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {benefits.map((benefit) => (
              <div key={benefit.key} className="card-flat p-8 text-center">
                <div className="w-14 h-14 rounded-2xl bg-primary/[0.06] text-primary flex items-center justify-center mx-auto mb-4">
                  <benefit.Icon className="h-7 w-7" />
                </div>
                <h3 className="font-display font-bold text-lg mb-2">{t(`home.why.${benefit.key}.title`)}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{t(`home.why.${benefit.key}.desc`)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* AI Assistant CTA */}
      <section className="section-padding-sm">
        <div className="container mx-auto px-4">
          <div className="relative overflow-hidden rounded-3xl gradient-brand p-8 md:p-12">
            <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />
            <div className="relative grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
              <div>
                <div className="inline-flex items-center gap-2 bg-white/20 rounded-full px-4 py-1.5 text-xs font-semibold text-white mb-4">
                  <MessageCircle className="h-3.5 w-3.5" />
                  {t("home.aiCta.badge")}
                </div>
                <h2 className="text-2xl md:text-3xl font-display font-extrabold text-white mb-3">
                  {t("home.aiCta.title")}
                </h2>
                <p className="text-white/90 text-sm leading-relaxed mb-6 max-w-md">
                  {t("home.aiCta.desc")}
                </p>
                <p className="text-white/80 text-xs">
                  {t("home.aiCta.hint")}
                </p>
              </div>
              <div className="hidden md:flex justify-center">
                <div className="w-48 h-48 rounded-full bg-white/10 flex items-center justify-center">
                  <MessageCircle className="h-20 w-20 text-white/30" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Brands Section */}
      <section className="section-padding-sm border-t border-border">
        <div className="container mx-auto px-4">
          <p className="text-center text-xs text-muted-foreground uppercase tracking-widest font-semibold mb-8">
            {t("home.brandsLabel")}
          </p>
          <div className="flex flex-wrap justify-center items-center gap-8 md:gap-12">
            {["Dell", "HP", "Lenovo", "Cisco", "Microsoft", "Intel", "AMD", "NVIDIA"].map((brand) => (
              <span
                key={brand}
                className="font-display font-bold text-lg text-foreground/80 hover:text-foreground transition-colors cursor-default"
              >
                {brand}
              </span>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
};

export default Index;
