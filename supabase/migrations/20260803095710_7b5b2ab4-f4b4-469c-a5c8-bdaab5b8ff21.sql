
GRANT SELECT ON public.sync_logs TO authenticated;
GRANT SELECT ON public.automation_events TO authenticated;

-- get_product_admin_view is a SECURITY INVOKER wrapper over a private impl that
-- authenticated may not execute; make the wrapper definer (impl already checks admin).
CREATE OR REPLACE FUNCTION public.get_product_admin_view()
RETURNS TABLE(id uuid, cost_price numeric, selling_price numeric, margin_percentage numeric, axiz_product_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY SELECT * FROM private.get_product_admin_view_impl(auth.uid());
END;
$function$;
REVOKE ALL ON FUNCTION public.get_product_admin_view() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_product_admin_view() TO authenticated, service_role;

-- Newsletter interests wrapper is SECURITY INVOKER but anon lacks USAGE on schema private.
GRANT USAGE ON SCHEMA private TO anon;
