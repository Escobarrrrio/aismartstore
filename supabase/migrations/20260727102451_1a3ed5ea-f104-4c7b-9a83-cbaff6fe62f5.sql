
-- Finding 2: public.get_compliance_pack must run as its owner (SECURITY DEFINER)
-- because it forwards into the `private` schema, which anon has no USAGE on.
-- The wrapper still authorizes explicitly inside private.get_compliance_pack_impl.
CREATE OR REPLACE FUNCTION public.get_compliance_pack(_quote_id uuid, _email text)
 RETURNS SETOF public.compliance_documents
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY SELECT * FROM private.get_compliance_pack_impl(_quote_id, _email, auth.uid());
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_compliance_pack(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_compliance_pack(uuid, text) TO anon, authenticated, service_role;

-- Finding 3: public.get_product_admin_view must run as SECURITY DEFINER so the
-- admin caller can read product_costs (SELECT is revoked from authenticated).
-- The function already enforces `has_role(auth.uid(), 'admin')` internally.
CREATE OR REPLACE FUNCTION public.get_product_admin_view()
 RETURNS TABLE(id uuid, cost_price numeric, selling_price numeric, margin_percentage numeric, axiz_product_id text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
GRANT EXECUTE ON FUNCTION public.get_product_admin_view() TO authenticated, service_role;
