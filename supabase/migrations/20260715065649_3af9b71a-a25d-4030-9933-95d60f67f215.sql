
CREATE OR REPLACE FUNCTION public.search_products(search_query text DEFAULT ''::text, filter_category text DEFAULT NULL::text, filter_brand text DEFAULT NULL::text, filter_ai_only boolean DEFAULT false, filter_in_stock_only boolean DEFAULT false, min_price numeric DEFAULT NULL::numeric, max_price numeric DEFAULT NULL::numeric, sort_by text DEFAULT 'relevance'::text, page_number integer DEFAULT 0, page_size integer DEFAULT 24)
 RETURNS TABLE(id uuid, sku text, slug text, name text, description text, price numeric, category text, brand text, stock_quantity integer, in_stock boolean, images text[], is_ai_product boolean, total_count bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  has_search  boolean := btrim(coalesce(search_query, '')) <> '';
  ts_query    tsquery;
  v_sort      text := coalesce(sort_by, 'relevance');
BEGIN
  IF has_search THEN
    ts_query := plainto_tsquery('english', search_query);
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
$function$;
