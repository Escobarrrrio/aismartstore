
CREATE TABLE public.compliance_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_legal_name text NOT NULL,
  cipc_registration_number text,
  vat_number text,
  tax_reference_number text,
  csd_supplier_number text,
  bbbee_level text,
  bbbee_certificate_url text,
  bank_name text,
  bank_account_number text,
  bank_branch_code text,
  account_manager_name text,
  account_manager_email text,
  account_manager_phone text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.compliance_documents TO authenticated;
GRANT ALL ON public.compliance_documents TO service_role;

ALTER TABLE public.compliance_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage compliance documents"
ON public.compliance_documents FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_compliance_documents_updated_at
BEFORE UPDATE ON public.compliance_documents
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.compliance_documents (
  entity_legal_name, cipc_registration_number, vat_number, tax_reference_number,
  csd_supplier_number, bbbee_level, bank_name, bank_account_number, bank_branch_code,
  account_manager_name, account_manager_email, account_manager_phone, notes
) VALUES (
  'AI Smart Store (Pty) Ltd',
  'Available on request',
  'Available on request',
  'Available on request',
  'MAAA-XXXXXXX (verified active)',
  'Level 1 Contributor (EME)',
  'Available on request',
  'Available on request',
  'Available on request',
  'John Dlomo',
  'procurement@aismartstore.co.za',
  '+27 (0) 00 000 0000',
  'Full verified compliance pack (CIPC disclosure, B-BBEE certificate, CSD confirmation, banking confirmation letter, and tax clearance status) will be emailed within one business day of your quote request. Administrators can edit these values from the admin panel.'
);

-- SECURITY DEFINER: gates access to the private pack behind proof that the
-- requesting party submitted a matching quote_request (id + email). Public
-- users cannot read compliance_documents directly; they can only receive it
-- via this function after submitting the form on /procurement.
CREATE OR REPLACE FUNCTION public.get_compliance_pack(_quote_id uuid, _email text)
RETURNS SETOF public.compliance_documents
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF _quote_id IS NULL OR _email IS NULL OR btrim(_email) = '' THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.quote_requests
    WHERE id = _quote_id AND lower(email) = lower(btrim(_email))
  ) THEN
    RETURN;
  END IF;
  RETURN QUERY SELECT * FROM public.compliance_documents ORDER BY created_at ASC LIMIT 1;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_compliance_pack(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_compliance_pack(uuid, text) TO anon, authenticated, service_role;
