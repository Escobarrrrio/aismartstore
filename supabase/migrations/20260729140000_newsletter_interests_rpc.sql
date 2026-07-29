-- Let a shopper record which topics they want to hear about.
--
-- The footer's "What should we tell you about first?" chips called
-- `newsletter_subscribers.update(...)` straight from the browser. But that
-- table only ever had an INSERT policy for the public role:
--
--   "Anyone can subscribe"          FOR INSERT  TO public
--   "Admins can manage subscribers" FOR ALL     TO authenticated (admin only)
--
-- With no UPDATE policy, RLS silently matched zero rows for every ordinary
-- visitor. supabase-js does not error on an update that matches nothing, so the
-- chip turned blue, the UI looked like it worked, and the preference was thrown
-- away every single time.
--
-- Adding a public UPDATE policy would be the wrong fix: it would let anyone
-- rewrite any subscriber's row by guessing an email address. Instead this
-- mirrors the ownership-proof pattern already used by get_compliance_pack --
-- the caller must present the subscriber id returned by their own INSERT
-- together with the matching email. The id is an unguessable uuid, so only the
-- person who actually subscribed can set that row's interests, and the function
-- can touch nothing but the interests column.

CREATE OR REPLACE FUNCTION public.set_newsletter_interests(
  _subscriber_id uuid,
  _email         text,
  _categories    text[]
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  -- Whitelisted so the column can't be used as arbitrary attacker-controlled
  -- storage. Must stay in step with CATEGORIES in NewsletterSignup.tsx.
  allowed  text[] := ARRAY['ai', 'networking', 'computing', 'software'];
  cleaned  text[];
  updated  integer;
BEGIN
  IF _subscriber_id IS NULL OR _email IS NULL OR btrim(_email) = '' THEN
    RETURN false;
  END IF;

  SELECT coalesce(array_agg(DISTINCT c), ARRAY[]::text[])
    INTO cleaned
    FROM unnest(coalesce(_categories, ARRAY[]::text[])) AS c
   WHERE c = ANY (allowed);

  UPDATE public.newsletter_subscribers
     SET interested_categories = cleaned
   WHERE id = _subscriber_id
     AND lower(email) = lower(btrim(_email));

  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated > 0;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_newsletter_interests(uuid, text, text[]) FROM public;
GRANT EXECUTE ON FUNCTION public.set_newsletter_interests(uuid, text, text[]) TO anon, authenticated;

COMMENT ON FUNCTION public.set_newsletter_interests(uuid, text, text[]) IS
  'Sets interested_categories for one subscriber, but only when the caller can present the subscriber id from their own signup together with the matching email. Returns false when the pair does not match. Unknown category keys are discarded.';
