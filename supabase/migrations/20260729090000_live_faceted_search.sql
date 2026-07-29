-- Live, context-aware facet counts for the product catalogue.
--
-- The previous implementation read `product_facets_cache` via the no-arg
-- `get_product_facets()`. That cache is (a) residential-only and (b) computed
-- with NO other filter applied, so the sidebar counts were simply wrong the
-- moment a shopper touched anything: with `?ai=1` (6 matching products) the
-- sidebar still advertised "Accessories 1 059" and "Hpe 837", and clicking
-- either returned a near-empty grid. Counts that lie are worse than no counts.
--
-- `search_product_facets` takes the SAME filter arguments as `search_products`
-- and counts against the same predicate set, so every number in the sidebar is
-- exactly the number of results you get by clicking it.
--
-- Facet-scoping rule (the standard Amazon/Takealot behaviour): a facet's own
-- selection is excluded from its own counts, while every other active filter is
-- applied. That way switching from "Servers" to "Cables" still shows Cables in
-- the list with a real count, instead of the category list collapsing to just
-- the one selected value.
--
-- Display values are picked with mode() over the case-insensitive group, so the
-- catalogue's real spelling wins ("HPE", not the initcap-mangled "Hpe").

CREATE OR REPLACE FUNCTION public.search_product_facets(
  search_query          text    DEFAULT ''::text,
  filter_category       text    DEFAULT NULL::text,
  filter_brand          text    DEFAULT NULL::text,
  filter_ai_only        boolean DEFAULT false,
  filter_in_stock_only  boolean DEFAULT false,
  min_price             numeric DEFAULT NULL::numeric,
  max_price             numeric DEFAULT NULL::numeric,
  filter_audience       text    DEFAULT 'residential'::text
)
RETURNS TABLE(facet_type text, facet_value text, product_count bigint)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  has_search boolean := btrim(coalesce(search_query, '')) <> '';
  ts_query   tsquery;
  v_audience text := lower(coalesce(filter_audience, 'residential'));
BEGIN
  IF has_search THEN
    ts_query := plainto_tsquery('english', search_query);
  END IF;

  RETURN QUERY
  WITH base AS (
    -- Audience + free-text search only. Everything else is layered per-scope
    -- below so each facet can relax exactly its own predicate.
    SELECT p.category, p.brand, p.is_ai_product, p.in_stock, p.price
    FROM public.products p
    WHERE p.is_active = true
      AND (v_audience = 'all' OR p.audience = v_audience)
      AND (
        NOT has_search
        OR p.search_vector @@ ts_query
        OR p.name % search_query
      )
  ),
  priced AS (
    SELECT * FROM base b
    WHERE (min_price IS NULL OR b.price >= min_price)
      AND (max_price IS NULL OR b.price <= max_price)
  ),
  -- Category counts: brand + toggles + price applied, category relaxed.
  cat_scope AS (
    SELECT * FROM priced b
    WHERE (filter_brand IS NULL OR lower(b.brand) = lower(filter_brand))
      AND (NOT filter_ai_only       OR b.is_ai_product = true)
      AND (NOT filter_in_stock_only OR b.in_stock = true)
  ),
  -- Brand counts: category + toggles + price applied, brand relaxed.
  brand_scope AS (
    SELECT * FROM priced b
    WHERE (filter_category IS NULL OR lower(b.category) = lower(filter_category))
      AND (NOT filter_ai_only       OR b.is_ai_product = true)
      AND (NOT filter_in_stock_only OR b.in_stock = true)
  ),
  -- Toggle counts: category + brand + price applied; each toggle relaxes
  -- itself but still respects the other toggle.
  toggle_scope AS (
    SELECT * FROM priced b
    WHERE (filter_category IS NULL OR lower(b.category) = lower(filter_category))
      AND (filter_brand    IS NULL OR lower(b.brand)    = lower(filter_brand))
  ),
  -- Price bounds: everything applied EXCEPT the price window itself, so the
  -- min/max hints describe the range the shopper could widen back out to.
  price_scope AS (
    SELECT * FROM base b
    WHERE (filter_category IS NULL OR lower(b.category) = lower(filter_category))
      AND (filter_brand    IS NULL OR lower(b.brand)    = lower(filter_brand))
      AND (NOT filter_ai_only       OR b.is_ai_product = true)
      AND (NOT filter_in_stock_only OR b.in_stock = true)
  )
  SELECT 'category'::text,
         mode() WITHIN GROUP (ORDER BY c.category)::text,
         count(*)::bigint
    FROM cat_scope c
   WHERE c.category IS NOT NULL AND btrim(c.category) <> ''
   GROUP BY lower(c.category)

  UNION ALL
  SELECT 'brand'::text,
         mode() WITHIN GROUP (ORDER BY b.brand)::text,
         count(*)::bigint
    FROM brand_scope b
   WHERE b.brand IS NOT NULL AND btrim(b.brand) <> ''
   GROUP BY lower(b.brand)

  UNION ALL
  SELECT 'toggle'::text, 'ai_ready'::text, count(*)::bigint
    FROM toggle_scope t
   WHERE t.is_ai_product = true
     AND (NOT filter_in_stock_only OR t.in_stock = true)

  UNION ALL
  SELECT 'toggle'::text, 'in_stock'::text, count(*)::bigint
    FROM toggle_scope t
   WHERE t.in_stock = true
     AND (NOT filter_ai_only OR t.is_ai_product = true)

  UNION ALL
  SELECT 'meta'::text, 'price_min'::text, floor(coalesce(min(p.price), 0))::bigint FROM price_scope p
  UNION ALL
  SELECT 'meta'::text, 'price_max'::text, ceil(coalesce(max(p.price), 0))::bigint  FROM price_scope p

  ORDER BY 1 ASC, 3 DESC, 2 ASC;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.search_product_facets(
  text, text, text, boolean, boolean, numeric, numeric, text
) TO anon, authenticated;

-- Supports the audience predicate that every catalogue query now carries.
CREATE INDEX IF NOT EXISTS idx_products_active_audience
  ON public.products (audience)
  WHERE is_active = true;
