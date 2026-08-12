-- ===========================================================================
-- Every quote request submission tells the visitor it failed, even the
-- ones that actually went through
-- ===========================================================================
--
-- Procurement.tsx submits with:
--   supabase.from("quote_requests").insert({...}).select("id, email").single()
--
-- `quote_requests` has exactly one SELECT policy ("Admins can manage quote
-- requests", admin-only) and no SELECT policy at all for anon/authenticated.
-- Postgres requires an INSERT ... RETURNING row to satisfy a SELECT policy,
-- not just the INSERT policy's WITH CHECK -- and raises an error if it
-- doesn't, rather than silently returning fewer rows. So the .select() half
-- of every real submission fails RLS, regardless of how valid the data is.
--
-- Reproduced directly against the live database: a plain INSERT (no
-- RETURNING) as the anon role succeeds outright; the identical INSERT with
-- RETURNING raises "new row violates row-level security policy".
--
-- The existing frontend code assumed the only failure mode here was
-- PGRST116 (zero rows, from the threat-gate trigger quietly discarding a
-- quarantined submission) and treated that as a successful send. This is a
-- different failure -- a real Postgres error, with a real row already
-- sitting in the table -- so it falls into the *other* branch instead:
-- `toast({ title: "Couldn't send your request", ... })`. The lead is
-- captured. The visitor is told it failed. They have no way to know their
-- enquiry actually reached anyone, and every genuine compliance-pack unlock
-- immediately after it never ran either, because `inserted` was never set.
--
-- FIX
-- ---
-- A SECURITY DEFINER RPC, the same pattern get_compliance_pack already uses
-- one step later in this exact flow: it does the insert (still subject to
-- the threat-gate BEFORE INSERT trigger and the audit-log AFTER INSERT
-- trigger, unchanged) and hands back (id, email) directly, without ever
-- needing the caller to have SELECT rights on the table. This is the
-- correct fix, not widening the SELECT policy to anon -- doing that would
-- let anyone read every other submitter's name, email, phone and
-- requirements, a real privacy exposure introduced to fix a UX bug.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.submit_quote_request(
  p_organisation_name text,
  p_entity_type       text,
  p_contact_name      text,
  p_email             text,
  p_phone             text,
  p_requirements      text,
  p_estimated_value   numeric DEFAULT NULL
) RETURNS TABLE(id uuid, email text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  -- Same shape the INSERT policy's WITH CHECK already enforced -- kept here
  -- too so this function has its own real validation and doesn't rely on
  -- RLS alone (a SECURITY DEFINER function bypasses RLS on its own writes).
  IF length(coalesce(p_organisation_name, '')) < 2 OR length(coalesce(p_organisation_name, '')) > 200 THEN
    RAISE EXCEPTION 'organisation_name must be 2-200 characters';
  END IF;
  IF length(coalesce(p_contact_name, '')) < 2 OR length(coalesce(p_contact_name, '')) > 120 THEN
    RAISE EXCEPTION 'contact_name must be 2-120 characters';
  END IF;
  IF p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(p_email) < 5 OR length(p_email) > 320 THEN
    RAISE EXCEPTION 'a valid email is required';
  END IF;
  IF length(coalesce(p_requirements, '')) < 10 OR length(p_requirements) > 5000 THEN
    RAISE EXCEPTION 'requirements must be 10-5000 characters';
  END IF;
  IF p_entity_type != ALL (ARRAY['government', 'private', 'contractor', 'other']) THEN
    RAISE EXCEPTION 'entity_type must be one of government, private, contractor, other';
  END IF;
  IF p_phone IS NOT NULL AND (length(p_phone) < 5 OR length(p_phone) > 40) THEN
    RAISE EXCEPTION 'phone must be 5-40 characters';
  END IF;
  IF p_estimated_value IS NOT NULL AND (p_estimated_value < 0 OR p_estimated_value >= 1000000000) THEN
    RAISE EXCEPTION 'estimated_value out of range';
  END IF;

  INSERT INTO public.quote_requests
    (organisation_name, entity_type, contact_name, email, phone, requirements, estimated_value)
  VALUES
    (p_organisation_name, p_entity_type, p_contact_name, p_email, p_phone, p_requirements, p_estimated_value)
  RETURNING quote_requests.id INTO v_id;

  -- v_id is NULL when the BEFORE INSERT threat-gate trigger quarantined this
  -- submission (it returns NULL instead of NEW, so nothing was written).
  -- That is not an error -- it's handled by the caller returning zero rows,
  -- same as the RETURNING-based query the frontend used to run.
  IF v_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY SELECT v_id, p_email;
END;
$$;
COMMENT ON FUNCTION public.submit_quote_request(text, text, text, text, text, text, numeric) IS
  'Public entry point for the Request a Quote form. Bypasses the need for an anon SELECT policy on quote_requests (which would otherwise expose every submitter''s contact details) by returning (id, email) directly from the same SECURITY DEFINER call that performs the insert.';

GRANT EXECUTE ON FUNCTION public.submit_quote_request(text, text, text, text, text, text, numeric) TO anon, authenticated;
