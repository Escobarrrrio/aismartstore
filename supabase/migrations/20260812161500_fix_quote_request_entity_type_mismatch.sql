-- ===========================================================================
-- The Request a Quote form rejects half its own dropdown options
-- ===========================================================================
--
-- Procurement.tsx's ENTITY_TYPES offers exactly four choices, and its form
-- state defaults entity_type to one of them:
--
--   government, private, contractor, other
--
-- The INSERT policy's WITH CHECK allowed a different, unrelated set:
--
--   private, public, ngo, education, government, sme, enterprise
--
-- Only two of the four buttons on the actual page (Government/Municipal,
-- Private Enterprise) match a value the database will accept. The other
-- two -- Contractor / Subcontractor and Other -- are real, clickable
-- buttons in the live UI that always fail with a bare Postgres
-- "row-level security policy violation", surfaced to the visitor as
-- "Couldn't send your request. Please try again." with no way to actually
-- fix it by trying again, because the value they picked is categorically
-- rejected.
--
-- Reproduced directly against the live database before this fix (as the
-- anon role, the same one the public form submits as):
--   INSERT INTO quote_requests (..., entity_type, ...) VALUES (..., 'contractor', ...);
--   -> ERROR: 42501: new row violates row-level security policy
--
-- Fixed the constraint to match what the form actually sends, rather than
-- guessing which side was "right" -- the four-option UI (with Contractor/
-- Subcontractor as a distinct category) is the deliberate, purpose-built
-- shape for a South African government/enterprise tender form; the other
-- list was never wired to anything.
-- ===========================================================================

DROP POLICY IF EXISTS "Anyone can submit a validated quote request" ON public.quote_requests;

CREATE POLICY "Anyone can submit a validated quote request"
  ON public.quote_requests FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    length(coalesce(organisation_name, '')) >= 2
    AND length(coalesce(organisation_name, '')) <= 200
    AND length(coalesce(contact_name, '')) >= 2
    AND length(coalesce(contact_name, '')) <= 120
    AND email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    AND length(email) >= 5 AND length(email) <= 320
    AND length(requirements) >= 10 AND length(requirements) <= 5000
    AND entity_type = ANY (ARRAY['government', 'private', 'contractor', 'other'])
    AND (estimated_value IS NULL OR (estimated_value >= 0 AND estimated_value < 1000000000))
    AND (phone IS NULL OR (length(phone) >= 5 AND length(phone) <= 40))
  );
