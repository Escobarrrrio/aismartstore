-- ===========================================================================
-- Newsletter signup has the exact same bug the quote-request form had, on
-- the single highest-traffic form on the site (it's in the footer of every
-- page)
-- ===========================================================================
--
-- NewsletterSignup.tsx submits with:
--   supabase.from("newsletter_subscribers").insert({ email, source }).select("id").single()
--
-- newsletter_subscribers has an INSERT policy open to everyone ("Anyone can
-- subscribe") but its only SELECT policy is admin-only ("Admins can manage
-- subscribers"). Postgres requires an INSERT ... RETURNING row to satisfy a
-- SELECT policy or the whole statement -- not just the RETURNING clause,
-- the INSERT too, confirmed directly: a plain INSERT with RETURNING as the
-- anon role leaves zero rows behind, same statement without RETURNING
-- leaves one -- rolls back. Every non-duplicate, non-quarantined newsletter
-- signup has been failing outright: no row, and the visitor is shown
-- "Couldn't subscribe" with a raw RLS error.
--
-- (This also means the equivalent claim in the quote-request fix
-- (20260812162000) that "the lead was captured, but the visitor was shown
-- an error" was wrong in exactly this same way -- it was never captured
-- either. Corrected here in case anyone reads this file looking for how
-- that one behaved too.)
--
-- The comment already in NewsletterSignup.tsx says "Anon cannot SELECT from
-- newsletter_subscribers (emails are private)" and correctly works around
-- it for the subscriber-count query a few lines above with a SECURITY
-- DEFINER RPC -- just never applied the same fix to the insert itself.
--
-- Same fix as the quote request: a SECURITY DEFINER RPC that inserts and
-- returns the id directly, instead of widening SELECT to anon (which would
-- let anyone harvest every subscriber's email address).
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.subscribe_to_newsletter(
  p_email  text,
  p_source text DEFAULT 'footer'
) RETURNS TABLE(id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_email !~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
     OR length(p_email) < 5 OR length(p_email) > 254 THEN
    RAISE EXCEPTION 'a valid email is required';
  END IF;

  INSERT INTO public.newsletter_subscribers (email, source)
  VALUES (p_email, coalesce(nullif(btrim(p_source), ''), 'footer'))
  RETURNING newsletter_subscribers.id INTO v_id;

  -- NULL when the BEFORE INSERT threat-gate trigger quarantined this
  -- submission -- zero rows back, same as before, not an error.
  IF v_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY SELECT v_id;
  -- A duplicate email hits newsletter_subscribers' own unique constraint on
  -- the INSERT above and aborts the function with SQLSTATE 23505 unchanged
  -- -- no explicit handling needed here for the frontend's existing
  -- `error.code === "23505"` check to keep working.
END;
$$;
COMMENT ON FUNCTION public.subscribe_to_newsletter(text, text) IS
  'Public entry point for newsletter signup. Bypasses the need for an anon SELECT policy on newsletter_subscribers (which would let anyone harvest every subscriber''s email) by returning the new id directly from the same SECURITY DEFINER call that performs the insert.';

GRANT EXECUTE ON FUNCTION public.subscribe_to_newsletter(text, text) TO anon, authenticated;
