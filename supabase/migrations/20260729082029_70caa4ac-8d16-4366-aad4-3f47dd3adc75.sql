
-- 1) get_compliance_pack: convert public wrapper to SECURITY INVOKER
--    (delegates to private.get_compliance_pack_impl which remains SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.get_compliance_pack(_quote_id uuid, _email text)
RETURNS SETOF public.compliance_documents
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY SELECT * FROM private.get_compliance_pack_impl(_quote_id, _email, auth.uid());
END;
$function$;

-- 2) get_product_admin_view: move impl to private (SECURITY DEFINER with admin check),
--    keep public wrapper as SECURITY INVOKER
CREATE OR REPLACE FUNCTION private.get_product_admin_view_impl(_caller uuid)
RETURNS TABLE(id uuid, cost_price numeric, selling_price numeric, margin_percentage numeric, axiz_product_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.has_role(_caller, 'admin') THEN
    RAISE EXCEPTION 'Admin role required';
  END IF;
  RETURN QUERY
    SELECT pc.product_id, pc.cost_price, pc.selling_price, pc.margin_percentage, pc.axiz_product_id
    FROM public.product_costs pc;
END;
$function$;

REVOKE ALL ON FUNCTION private.get_product_admin_view_impl(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_product_admin_view()
RETURNS TABLE(id uuid, cost_price numeric, selling_price numeric, margin_percentage numeric, axiz_product_id text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY SELECT * FROM private.get_product_admin_view_impl(auth.uid());
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_product_admin_view() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_compliance_pack(uuid, text) TO anon, authenticated;
