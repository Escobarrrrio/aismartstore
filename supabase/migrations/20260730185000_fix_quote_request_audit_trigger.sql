-- ===========================================================================
-- The business quote form has never worked
-- ===========================================================================
--
-- `log_quote_request_submitted()` is an AFTER INSERT audit trigger on
-- `quote_requests`. It builds its metadata from `NEW.company`.
--
-- There is no `company` column. The column is `organisation_name`.
--
-- A missing field reference in PL/pgSQL is a runtime error, not a compile-time
-- one, so the function was created without complaint and then raised
-- `record "new" has no field "company"` on every single insert. The trigger
-- fires inside the inserting transaction, so the error took the insert down
-- with it.
--
-- Every business quote request ever submitted was rejected. `quote_requests`
-- has zero rows and `compliance_access_log` has zero `quote_submitted` events,
-- which is what a form that has never once succeeded looks like from the
-- inside.
--
-- Nothing surfaced it because nothing was watching this path: the failure is a
-- 500 in the visitor's browser and a log line nobody reads. It was found by
-- writing a test that submits a realistic government tender enquiry -- the
-- first time anything had actually posted the form since it was built.
--
-- This is the enquiry path for the whole B2B side of the store, the same page
-- that 20260730140000 spent an engine ranking by expected profit. Ranking the
-- products beautifully on a page whose contact form silently discards every
-- lead is worth nothing.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.log_quote_request_submitted()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  INSERT INTO public.compliance_access_log(event_type, quote_request_id, email, actor_id, metadata)
  VALUES ('quote_submitted', NEW.id, NEW.email, auth.uid(),
          jsonb_build_object('organisation', NEW.organisation_name, 'contact_name', NEW.contact_name));
  RETURN NEW;
END $fn$;
