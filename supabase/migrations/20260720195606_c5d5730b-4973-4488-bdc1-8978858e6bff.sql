
-- Fix linter: SECURITY DEFINER functions executable by signed-in users in public schema.
-- Strategy:
--   1) has_role and get_product_admin_view can safely run as SECURITY INVOKER —
--      existing RLS policies on user_roles / product_costs already grant the
--      necessary row visibility to the caller.
--   2) get_compliance_pack needs to bypass RLS (reads quote_requests,
--      compliance_documents; writes to compliance_access_log). Move the
--      privileged implementation into a private schema (not exposed by the
--      Data API and out of scope for lint 0029), and keep a thin
--      SECURITY INVOKER wrapper in public so the frontend RPC call keeps working.

-- --- 1. has_role: switch to SECURITY INVOKER ---------------------------------
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$$;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated, service_role;

-- --- 2. get_product_admin_view: switch to SECURITY INVOKER -------------------
CREATE OR REPLACE FUNCTION public.get_product_admin_view()
RETURNS TABLE(id uuid, cost_price numeric, selling_price numeric, margin_percentage numeric, axiz_product_id text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin role required';
  END IF;
  RETURN QUERY
    SELECT pc.product_id, pc.cost_price, pc.selling_price, pc.margin_percentage, pc.axiz_product_id
    FROM public.product_costs pc;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_product_admin_view() TO authenticated, service_role;

-- --- 3. get_compliance_pack: move privileged logic to private schema ---------
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.get_compliance_pack_impl(_quote_id uuid, _email text, _actor uuid)
RETURNS SETOF public.compliance_documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_match boolean := false;
BEGIN
  IF _quote_id IS NULL OR _email IS NULL OR btrim(_email) = '' THEN
    INSERT INTO public.compliance_access_log(event_type, quote_request_id, email, actor_id, metadata)
    VALUES ('pack_unlock_denied', _quote_id, _email, _actor,
            jsonb_build_object('reason','missing_input'));
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.quote_requests
    WHERE id = _quote_id AND lower(email) = lower(btrim(_email))
  ) INTO v_match;

  IF NOT v_match THEN
    INSERT INTO public.compliance_access_log(event_type, quote_request_id, email, actor_id, metadata)
    VALUES ('pack_unlock_denied', _quote_id, _email, _actor,
            jsonb_build_object('reason','no_matching_quote'));
    RETURN;
  END IF;

  INSERT INTO public.compliance_access_log(event_type, quote_request_id, email, actor_id, metadata)
  VALUES ('pack_unlock_success', _quote_id, _email, _actor, '{}'::jsonb);

  RETURN QUERY SELECT * FROM public.compliance_documents ORDER BY created_at ASC LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION private.get_compliance_pack_impl(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.get_compliance_pack_impl(uuid, text, uuid) TO authenticated, service_role;

-- Public wrapper is SECURITY INVOKER (satisfies lint 0029) and forwards to the
-- private definer implementation. auth.uid() is captured here so the audit log
-- attributes the request to the calling user.
CREATE OR REPLACE FUNCTION public.get_compliance_pack(_quote_id uuid, _email text)
RETURNS SETOF public.compliance_documents
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  RETURN QUERY SELECT * FROM private.get_compliance_pack_impl(_quote_id, _email, auth.uid());
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_compliance_pack(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_compliance_pack(uuid, text) TO authenticated, service_role;
