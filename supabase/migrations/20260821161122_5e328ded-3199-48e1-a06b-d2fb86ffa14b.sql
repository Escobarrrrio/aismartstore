REVOKE ALL ON FUNCTION public.refresh_product_copurchases() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_product_copurchases() TO service_role;