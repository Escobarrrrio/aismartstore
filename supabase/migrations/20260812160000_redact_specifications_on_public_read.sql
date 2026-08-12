-- ===========================================================================
-- Stop shipping cost/margin data to every visitor's browser
-- ===========================================================================
--
-- ProductDetail.tsx fetches `products.specifications` directly with the anon
-- key: `.from("products").select("specifications, videos")`. The client-side
-- renderer (src/lib/specifications.ts HIDDEN_SPEC_KEYS) already stops the
-- sensitive keys from being *displayed* -- but that list had real gaps
-- (found and fixed alongside this migration: `source_url`/`notes` never
-- matched the actual stored keys `product_url`/`note`, and `supplier`,
-- `supplier_status`, `markup_pct`, `supplier_cost_zar` were never listed at
-- all). Even with that list fixed, the *raw* jsonb -- literal cost basis and
-- profit margin on the products that carry it -- still leaves the server in
-- the network response, visible to anyone who opens devtools. A UI filter is
-- not a data boundary.
--
-- This function is the real boundary: it strips the same sensitive keys
-- server-side, so the browser never receives them regardless of what the
-- client renders. `is_active` is re-checked here too, matching every other
-- public read path in this project (products/public-products-api).
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.get_product_specifications(p_id uuid)
RETURNS TABLE(specifications jsonb, videos text[])
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT
    (p.specifications - ARRAY[
      'manually_sourced', 'checked_at', 'supplier_sku', 'supplier', 'supplier_status',
      'product_url', 'source_url', 'note', 'notes', 'pending_photo',
      'markup_pct', 'markup_percent', 'markup_percentage',
      'supplier_cost_zar', 'cost', 'cost_zar', 'margin', 'margin_pct', 'margin_percentage'
    ]::text[]),
    p.videos
  FROM public.products p
  WHERE p.id = p_id AND p.is_active;
$$;
COMMENT ON FUNCTION public.get_product_specifications(uuid) IS
  'Public-safe specifications + videos for a product page. Strips supplier identity, sourcing links, and cost/margin keys server-side -- the client-side HIDDEN_SPEC_KEYS filter (src/lib/specifications.ts) is UI polish on top of this, not the actual boundary.';

GRANT EXECUTE ON FUNCTION public.get_product_specifications(uuid) TO anon, authenticated, service_role;
