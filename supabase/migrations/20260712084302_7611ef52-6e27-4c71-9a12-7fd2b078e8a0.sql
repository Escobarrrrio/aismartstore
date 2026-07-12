
CREATE OR REPLACE FUNCTION public.get_product_facets()
RETURNS TABLE(facet_type text, facet_value text, product_count bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT c.facet_type, c.facet_value, c.product_count
  FROM public.product_facets_cache c
  ORDER BY c.facet_type ASC, c.product_count DESC;
$$;

REVOKE ALL ON FUNCTION public.get_product_facets() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_product_facets() TO anon, authenticated, service_role;
