-- Case-insensitive facets: merge "accessories" and "Accessories" into one entry.
CREATE OR REPLACE FUNCTION public.get_product_facets()
RETURNS TABLE(facet_type text, facet_value text, product_count bigint)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT 'category', initcap(lower(category)) AS facet_value, count(*)::bigint
    FROM products
    WHERE is_active = true AND category IS NOT NULL AND btrim(category) <> ''
    GROUP BY initcap(lower(category))
  UNION ALL
  SELECT 'brand', initcap(lower(brand)), count(*)::bigint
    FROM products
    WHERE is_active = true AND brand IS NOT NULL AND btrim(brand) <> ''
    GROUP BY initcap(lower(brand))
  ORDER BY 1, 3 DESC;
$$;

-- Make the search RPC match category/brand case-insensitively so the normalised
-- facet value selected in the dropdown matches every product regardless of casing.
CREATE OR REPLACE FUNCTION public.search_products(
  search_query text DEFAULT '',
  filter_category text DEFAULT NULL,
  filter_brand text DEFAULT NULL,
  filter_ai_only boolean DEFAULT false,
  filter_in_stock_only boolean DEFAULT false,
  min_price numeric DEFAULT NULL,
  max_price numeric DEFAULT NULL,
  sort_by text DEFAULT 'relevance',
  page_number integer DEFAULT 0,
  page_size integer DEFAULT 24
)
RETURNS TABLE(id uuid, sku text, slug text, name text, description text, price numeric, category text, brand text, stock_quantity integer, in_stock boolean, images text[], is_ai_product boolean, total_count bigint)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  has_search  boolean := btrim(coalesce(search_query, '')) <> '';
  has_filters boolean := filter_category IS NOT NULL
                      OR filter_brand IS NOT NULL
                      OR filter_ai_only
                      OR filter_in_stock_only
                      OR min_price IS NOT NULL
                      OR max_price IS NOT NULL;
  ts_query    tsquery;
  v_total     bigint;
  v_sort      text := coalesce(sort_by, 'relevance');
BEGIN
  IF has_search THEN
    ts_query := plainto_tsquery('english', search_query);
  END IF;

  IF NOT has_search AND NOT has_filters THEN
    SELECT reltuples::bigint INTO v_total
      FROM pg_class WHERE oid = 'public.products'::regclass;
    v_total := GREATEST(v_total / 2, 1);

    RETURN QUERY
      SELECT p.id, p.sku, p.slug, p.name, p.description, p.price,
             p.category, p.brand, p.stock_quantity, p.in_stock,
             p.images, p.is_ai_product, v_total
      FROM public.products p
      WHERE p.is_active = true
      ORDER BY
        CASE WHEN v_sort = 'price_asc'  THEN p.price END ASC  NULLS LAST,
        CASE WHEN v_sort = 'price_desc' THEN p.price END DESC NULLS LAST,
        p.last_synced_at DESC NULLS LAST,
        p.name ASC
      LIMIT page_size OFFSET page_number * page_size;
    RETURN;
  END IF;

  RETURN QUERY
    SELECT p.id, p.sku, p.slug, p.name, p.description, p.price,
           p.category, p.brand, p.stock_quantity, p.in_stock,
           p.images, p.is_ai_product,
           count(*) OVER() AS total_count
    FROM public.products p
    WHERE p.is_active = true
      AND (
        NOT has_search
        OR p.search_vector @@ ts_query
        OR p.name % search_query
      )
      AND (filter_category IS NULL OR lower(p.category) = lower(filter_category))
      AND (filter_brand    IS NULL OR lower(p.brand)    = lower(filter_brand))
      AND (NOT filter_ai_only       OR p.is_ai_product = true)
      AND (NOT filter_in_stock_only OR p.in_stock = true)
      AND (min_price IS NULL OR p.price >= min_price)
      AND (max_price IS NULL OR p.price <= max_price)
    ORDER BY
      CASE WHEN v_sort = 'relevance' AND has_search
           THEN ts_rank(p.search_vector, ts_query) + similarity(p.name, search_query)
      END DESC NULLS LAST,
      CASE WHEN v_sort = 'price_asc'  THEN p.price END ASC  NULLS LAST,
      CASE WHEN v_sort = 'price_desc' THEN p.price END DESC NULLS LAST,
      CASE WHEN v_sort = 'newest'     THEN p.last_synced_at END DESC NULLS LAST,
      p.name ASC
    LIMIT page_size OFFSET page_number * page_size;
END;
$$;