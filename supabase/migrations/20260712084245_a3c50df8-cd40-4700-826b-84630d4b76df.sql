
-- Cached facet table (tiny, always fast)
CREATE TABLE IF NOT EXISTS public.product_facets_cache (
  facet_type text NOT NULL,
  facet_value text NOT NULL,
  product_count bigint NOT NULL,
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (facet_type, facet_value)
);

GRANT SELECT ON public.product_facets_cache TO anon, authenticated;
GRANT ALL ON public.product_facets_cache TO service_role;
ALTER TABLE public.product_facets_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Facets are public" ON public.product_facets_cache;
CREATE POLICY "Facets are public" ON public.product_facets_cache FOR SELECT USING (true);

-- Refresher: heavy scan, admin/service-role only. Uses long timeout locally.
CREATE OR REPLACE FUNCTION public.refresh_product_facets_cache()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET statement_timeout = '120s'
AS $$
DECLARE n integer;
BEGIN
  TRUNCATE public.product_facets_cache;
  INSERT INTO public.product_facets_cache (facet_type, facet_value, product_count)
  SELECT 'category', initcap(lower(category)), count(*)::bigint
    FROM public.products
    WHERE is_active = true AND category IS NOT NULL AND btrim(category) <> ''
    GROUP BY initcap(lower(category))
  UNION ALL
  SELECT 'brand', initcap(lower(brand)), count(*)::bigint
    FROM public.products
    WHERE is_active = true AND brand IS NOT NULL AND btrim(brand) <> ''
    GROUP BY initcap(lower(brand));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_product_facets_cache() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_product_facets_cache() TO service_role;

-- Fast public reader: reads pre-computed cache; auto-refreshes on cold start.
CREATE OR REPLACE FUNCTION public.get_product_facets()
RETURNS TABLE(facet_type text, facet_value text, product_count bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.product_facets_cache LIMIT 1) THEN
    PERFORM public.refresh_product_facets_cache();
  END IF;
  RETURN QUERY
    SELECT c.facet_type, c.facet_value, c.product_count
    FROM public.product_facets_cache c
    ORDER BY c.facet_type ASC, c.product_count DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_product_facets() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_product_facets() TO anon, authenticated, service_role;

-- Warm cache now
SELECT public.refresh_product_facets_cache();

-- Hourly refresh so the dropdown stays current after syncs
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    PERFORM cron.unschedule('refresh-product-facets') WHERE EXISTS (
      SELECT 1 FROM cron.job WHERE jobname='refresh-product-facets'
    );
    PERFORM cron.schedule(
      'refresh-product-facets', '17 * * * *',
      $cron$ SELECT public.refresh_product_facets_cache(); $cron$
    );
  END IF;
END $$;
