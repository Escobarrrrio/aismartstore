import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Package, Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { formatMoney } from "@/lib/currency";
import { trackEvent } from "@/lib/analytics";

/**
 * "Complete the setup" bundle.
 *
 * Backed by `get_recommended_products`, which blends two signals and never
 * crosses the Home/Business boundary:
 *   1. real co-purchase history from paid orders (collaborative filtering),
 *   2. a curated category-complement map as the cold-start fallback --
 *      a creator laptop pulls mice, colour-accurate monitors and storage
 *      rather than "four more laptops".
 */

export interface RecommendedRow {
  id: string;
  name: string;
  price: number | string;
  category: string | null;
  brand: string | null;
  images: string[] | null;
  in_stock: boolean;
  is_ai_product: boolean | null;
  audience: string;
  reason: string;
  score: number;
}

interface Props {
  productId: string;
  /** Locks the recommendation scope to the catalogue the shopper is browsing. */
  audience: "residential" | "business" | "all";
  title?: string;
  limit?: number;
}

const RecommendedBundle = ({ productId, audience, title = "Complete the setup", limit = 8 }: Props) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<RecommendedRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!productId) return;
    (async () => {
      const rpc = supabase.rpc as unknown as (
        name: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: RecommendedRow[] | null; error: { message: string } | null }>;
      const { data } = await rpc("get_recommended_products", {
        p_product_id: productId,
        p_audience: audience,
        p_limit: limit,
      });
      if (cancelled) return;
      const list = data ?? [];
      setRows(list);
      if (list.length > 0) trackEvent({ name: "recommendations_shown", productId, count: list.length });
    })();
    return () => {
      cancelled = true;
    };
  }, [productId, audience, limit]);

  if (rows.length === 0) return null;

  const hasCoPurchase = rows.some((r) => r.reason?.toLowerCase().includes("bought together"));

  return (
    <section className="mt-16 border-t border-border pt-12" data-testid="recommended-bundle">
      <h2 className="font-display font-bold text-xl mb-2">{title}</h2>
      <p className="text-sm text-muted-foreground mb-3">
        Picked to work with this product — not more of the same thing.
      </p>

      {/* Recommendations are opaque by default, and opaque recommendations get
          ignored. This spells out which signal produced the row the shopper is
          actually looking at, including the honest "we don't have purchase
          history for this SKU yet" case. */}
      <details className="mb-8 group">
        <summary className="cursor-pointer text-xs font-semibold text-primary hover:underline list-none inline-flex items-center gap-1.5">
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
          {t("recommendWhy.trigger")}
        </summary>
        <div className="mt-3 rounded-xl border border-border bg-muted/40 p-4 text-xs text-muted-foreground space-y-2 max-w-2xl">
          <p>{t("recommendWhy.intro")}</p>
          <ol className="list-decimal pl-4 space-y-1">
            {([1, 2, 3, 4] as const).map((tier) => (
              <li key={tier}>
                <span className="font-semibold text-foreground">{t(`recommendWhy.tier${tier}Label`)}</span>
                {" — "}
                {t(`recommendWhy.tier${tier}Text`)}
              </li>
            ))}
          </ol>
          {hasCoPurchase ? (
            <p>
              {t("recommendWhy.hasHistoryPrefix")}{" "}
              <span className="font-semibold text-foreground">{t("recommendWhy.hasHistoryTag")}</span>{" "}
              {t("recommendWhy.hasHistorySuffix")}
            </p>
          ) : (
            <p>{t("recommendWhy.noHistory")}</p>
          )}
          <p>{t("recommendWhy.scopeNote")}</p>
        </div>
      </details>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {rows.map((p) => (
          <Link key={p.id} to={`/product/${p.id}`} className="card-premium overflow-hidden group">
            <div className="aspect-[4/3] bg-muted overflow-hidden">
              {p.images?.[0] ? (
                <img
                  src={p.images[0]}
                  alt={p.name}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  loading="lazy"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground/60">
                  <Package className="h-8 w-8" aria-hidden="true" />
                </div>
              )}
            </div>
            <div className="p-4">
              <span className="inline-block text-[10px] font-bold uppercase tracking-wider text-primary mb-1.5">
                {p.reason}
              </span>
              <h3 className="font-display font-bold text-sm line-clamp-1 group-hover:text-primary transition-colors">
                {p.name}
              </h3>
              <p className="text-sm font-display font-extrabold mt-1">{formatMoney(Number(p.price))}</p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
};

export default RecommendedBundle;
