-- Restore EXECUTE grants required for RLS policies and RPCs to function for
-- authenticated users. The prior lockdown over-revoked and blocked normal
-- authenticated queries whose RLS invokes has_role(), plus two RPCs the app
-- depends on. All three functions have internal role/identity checks, so
-- granting EXECUTE to authenticated is safe.

-- 1. has_role is invoked from RLS USING/WITH CHECK across many tables.
--    Without EXECUTE to authenticated, every affected query aborts.
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

-- 2. get_product_admin_view must run as SECURITY DEFINER because it reads
--    product_costs (SELECT revoked from authenticated) and enforces admin
--    via an internal has_role() check. Restore DEFINER + grant EXECUTE.
CREATE OR REPLACE FUNCTION public.get_product_admin_view()
 RETURNS TABLE(id uuid, cost_price numeric, selling_price numeric, margin_percentage numeric, axiz_product_id text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin role required';
  END IF;
  RETURN QUERY
    SELECT pc.product_id, pc.cost_price, pc.selling_price, pc.margin_percentage, pc.axiz_product_id
    FROM public.product_costs pc;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_product_admin_view() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_product_admin_view() TO authenticated, service_role;

-- 3. get_compliance_pack is SECURITY DEFINER and validates the caller-supplied
--    email against the quote row before returning anything. Signed-in shoppers
--    hit /procurement as the authenticated role, so they need EXECUTE too.
GRANT EXECUTE ON FUNCTION public.get_compliance_pack(uuid, text) TO authenticated;
