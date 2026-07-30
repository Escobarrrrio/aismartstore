import { supabase } from "@/integrations/supabase/client";
import type { Product } from "@/contexts/CartContext";

/**
 * Reader for the curated home-page showcase.
 *
 * The ranking itself lives in the database (see the
 * `20260729160000_home_merchandising_engine` migration): every eligible
 * residential product is scored 0-100 on demand, brand, price band, title
 * readability, availability, photography and observed sales, then each slot is
 * filled greedily under per-brand and per-category diversity caps. This module
 * only reads the result.
 *
 * Every failure path returns an empty array rather than throwing, because the
 * home page must render even if the showcase is empty, stale or unreachable --
 * the caller falls back to its previous query. A merchandising engine that can
 * take the shop window down is worse than no merchandising engine.
 */

export type ShowcaseSlot = "ai_picks" | "featured";

export interface ShowcaseProduct extends Product {
  /**
   * Why the engine placed this product, in plain English. Not rendered on the
   * storefront (it is untranslated and reveals ranking internals) -- it exists
   * so the shop owner can interrogate the grid from Admin instead of having to
   * trust it.
   */
  merchReasons?: string[];
  merchScore?: number;
}

interface ShowcaseRow {
  id: string;
  name: string;
  description: string | null;
  price: number | string;
  category: string | null;
  brand: string | null;
  sku: string | null;
  images: string[] | null;
  in_stock: boolean | null;
  stock_quantity: number | null;
  is_ai_product: boolean | null;
  created_at: string | null;
  score: number | string | null;
  reasons: unknown;
}

const toReasons = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((r): r is string => typeof r === "string") : [];

export const mapShowcaseRow = (row: ShowcaseRow): ShowcaseProduct => ({
  id: row.id,
  name: row.name,
  description: row.description || "",
  price: Number(row.price),
  category: row.category || "",
  brand: row.brand || undefined,
  sku: row.sku || undefined,
  images: Array.isArray(row.images) ? row.images : [],
  inStock: !!row.in_stock,
  stockQuantity: typeof row.stock_quantity === "number" ? row.stock_quantity : undefined,
  isAiProduct: !!row.is_ai_product,
  createdAt: row.created_at || new Date().toISOString(),
  merchScore: row.score == null ? undefined : Number(row.score),
  merchReasons: toReasons(row.reasons),
});

export async function fetchShowcase(slot: ShowcaseSlot, limit = 8): Promise<ShowcaseProduct[]> {
  try {
    // `as never` on the RPC name: the generated Supabase types are regenerated
    // by the hosting platform and lag behind migrations applied out of band.
    const { data, error } = await supabase.rpc("get_home_showcase" as never, {
      p_slot: slot,
      p_limit: limit,
    } as never);
    if (error || !Array.isArray(data)) return [];
    // Defensive: a product whose images were stripped since the last refresh
    // would render as a blank tile, which is worse than a shorter grid.
    return (data as ShowcaseRow[])
      .filter((row) => row && row.id && Array.isArray(row.images) && row.images[0])
      .map(mapShowcaseRow);
  } catch {
    return [];
  }
}
