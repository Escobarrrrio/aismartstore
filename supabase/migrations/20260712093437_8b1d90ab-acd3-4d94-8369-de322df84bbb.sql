
-- Audit trail for compliance pack access + quote-request submissions
CREATE TABLE public.compliance_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL CHECK (event_type IN ('quote_submitted','pack_unlock_success','pack_unlock_denied')),
  quote_request_id uuid,
  email text,
  actor_id uuid,
  ip_address text,
  user_agent text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.compliance_access_log TO service_role;
-- No anon/authenticated grants: table is admin-read via policy + populated by SECURITY DEFINER code.

ALTER TABLE public.compliance_access_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read compliance access log"
ON public.compliance_access_log FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_compliance_access_log_quote ON public.compliance_access_log(quote_request_id);
CREATE INDEX idx_compliance_access_log_email ON public.compliance_access_log(lower(email));
CREATE INDEX idx_compliance_access_log_created ON public.compliance_access_log(created_at DESC);

-- Rewrite get_compliance_pack to audit every access attempt (success + denied)
CREATE OR REPLACE FUNCTION public.get_compliance_pack(_quote_id uuid, _email text)
RETURNS SETOF public.compliance_documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_match boolean := false;
BEGIN
  IF _quote_id IS NULL OR _email IS NULL OR btrim(_email) = '' THEN
    INSERT INTO public.compliance_access_log(event_type, quote_request_id, email, actor_id, metadata)
    VALUES ('pack_unlock_denied', _quote_id, _email, auth.uid(),
            jsonb_build_object('reason','missing_input'));
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.quote_requests
    WHERE id = _quote_id AND lower(email) = lower(btrim(_email))
  ) INTO v_match;

  IF NOT v_match THEN
    INSERT INTO public.compliance_access_log(event_type, quote_request_id, email, actor_id, metadata)
    VALUES ('pack_unlock_denied', _quote_id, _email, auth.uid(),
            jsonb_build_object('reason','no_matching_quote'));
    RETURN;
  END IF;

  INSERT INTO public.compliance_access_log(event_type, quote_request_id, email, actor_id, metadata)
  VALUES ('pack_unlock_success', _quote_id, _email, auth.uid(), '{}'::jsonb);

  RETURN QUERY SELECT * FROM public.compliance_documents ORDER BY created_at ASC LIMIT 1;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_compliance_pack(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_compliance_pack(uuid, text) TO anon, authenticated, service_role;

-- Log every submitted quote request via AFTER INSERT trigger
CREATE OR REPLACE FUNCTION public.log_quote_request_submitted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.compliance_access_log(event_type, quote_request_id, email, actor_id, metadata)
  VALUES ('quote_submitted', NEW.id, NEW.email, auth.uid(),
          jsonb_build_object('company', NEW.company, 'contact_name', NEW.contact_name));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_quote_request_submitted ON public.quote_requests;
CREATE TRIGGER trg_log_quote_request_submitted
AFTER INSERT ON public.quote_requests
FOR EACH ROW EXECUTE FUNCTION public.log_quote_request_submitted();
