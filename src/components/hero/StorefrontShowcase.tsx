import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Sparkles, RefreshCw, ArrowRight, PackageCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useLocale } from "@/contexts/LocaleContext";

type SpotlightProduct = {
  id: string;
  name: string;
  price: number;
  brand: string | null;
  image: string | null;
};

/**
 * Real-inventory hero panel: actual catalogue counts and actual products
 * with actual photos, not a decorative animation. What you see here is
 * what's in the store right now.
 */
const StorefrontShowcase = () => {
  const { formatPrice } = useLocale();
  const [live, setLive] = useState<{ skus: number | null; ai: number | null }>({ skus: null, ai: null });
  const [products, setProducts] = useState<SpotlightProduct[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ count: skus }, { count: ai }, { data: rows }] = await Promise.all([
        supabase.from("products").select("id", { count: "exact", head: true }).eq("is_active", true),
        supabase.from("products").select("id", { count: "exact", head: true }).eq("is_active", true).eq("is_ai_product", true),
        supabase
          .from("products")
          .select("id, name, price, brand, images")
          .eq("is_active", true)
          .eq("audience", "residential")
          .not("images", "is", null)
          .order("created_at", { ascending: false })
          .limit(12),
      ]);
      if (cancelled) return;
      setLive({ skus: skus ?? null, ai: ai ?? null });
      const withImages = ((rows as any[]) || [])
        .filter((p) => Array.isArray(p.images) && p.images[0])
        .slice(0, 3)
        .map((p) => ({ id: p.id, name: p.name, price: Number(p.price), brand: p.brand || null, image: p.images[0] }));
      setProducts(withImages);
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="card-premium p-5 md:p-6">
      <div className="flex items-center justify-between mb-4">
        <p className="font-display font-bold text-sm">Newest in stock</p>
        <Link to="/products" className="text-xs font-semibold text-primary hover:underline inline-flex items-center gap-1">
          Explore catalogue <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      <div className="space-y-2.5 mb-5">
        {products.length > 0 ? (
          products.map((p, i) => (
            <Link
              key={p.id}
              to={`/product/${p.id}`}
              className="flex items-center gap-3 p-2 rounded-xl hover:bg-muted/60 transition-colors group"
            >
              <div className="h-14 w-14 rounded-lg bg-white border border-border/60 overflow-hidden flex-shrink-0">
                <img
                  src={p.image!}
                  alt={p.name}
                  width={56}
                  height={56}
                  // All three rows sit in the fold-visible hero panel, so
                  // none should be lazy-loaded (that would deprioritize
                  // whichever one Lighthouse picks as the LCP candidate).
                  // Only the first gets fetchpriority="high" -- marking
                  // all three "high" would just have them compete for the
                  // same priority budget.
                  loading="eager"
                  fetchPriority={i === 0 ? "high" : "auto"}
                  className="h-full w-full object-contain p-1.5 group-hover:scale-105 transition-transform"
                />
              </div>
              <div className="min-w-0 flex-1">
                {p.brand && <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{p.brand}</p>}
                <p className="text-sm font-display font-semibold line-clamp-1 group-hover:text-primary transition-colors">{p.name}</p>
                <p className="text-sm font-display font-bold">{formatPrice(p.price)}</p>
              </div>
            </Link>
          ))
        ) : (
          [0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3 p-2">
              <div className="h-14 w-14 rounded-lg bg-muted animate-pulse flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-3 bg-muted rounded w-3/4 animate-pulse" />
                <div className="h-3 bg-muted rounded w-1/3 animate-pulse" />
              </div>
            </div>
          ))
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 pt-4 border-t border-border/60">
        <StatChip icon={<PackageCheck className="h-3.5 w-3.5" />} label="Live SKUs" value={live.skus === null ? "…" : live.skus.toLocaleString("en-ZA")} />
        <StatChip icon={<Sparkles className="h-3.5 w-3.5" />} label="AI-ready" value={live.ai === null ? "…" : live.ai.toLocaleString("en-ZA")} />
        <StatChip icon={<RefreshCw className="h-3.5 w-3.5" />} label="Distributor" value="Synced hourly" />
      </div>
    </div>
  );
};

const StatChip = ({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) => (
  <div className="text-center">
    <div className="flex items-center justify-center gap-1 text-primary mb-1">{icon}</div>
    <p className="font-display font-bold text-sm tabular-nums">{value}</p>
    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
  </div>
);

export default StorefrontShowcase;
