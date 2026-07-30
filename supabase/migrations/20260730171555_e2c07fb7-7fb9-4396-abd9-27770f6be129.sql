-- 1. Pin search_path on helper functions
ALTER FUNCTION public.ai_pulse_headline_quality(text) SET search_path = public, pg_temp;
ALTER FUNCTION public.ai_pulse_is_ai_story(text) SET search_path = public, pg_temp;
ALTER FUNCTION public.ai_pulse_story_categories(text) SET search_path = public, pg_temp;
ALTER FUNCTION public.biz_close_rate(numeric, boolean) SET search_path = public, pg_temp;
ALTER FUNCTION public.biz_repeat_factor(numeric) SET search_path = public, pg_temp;
ALTER FUNCTION public.clean_feed_text(text) SET search_path = public, pg_temp;
ALTER FUNCTION public.decode_feed_entities(text) SET search_path = public, pg_temp;
ALTER FUNCTION public.merch_availability(boolean, integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.merch_brand_trust(text) SET search_path = public, pg_temp;
ALTER FUNCTION public.merch_demand_tier(text, text, boolean) SET search_path = public, pg_temp;
ALTER FUNCTION public.merch_media_quality(text[]) SET search_path = public, pg_temp;
ALTER FUNCTION public.merch_name_quality(text) SET search_path = public, pg_temp;
ALTER FUNCTION public.merch_norm(text) SET search_path = public, pg_temp;
ALTER FUNCTION public.merch_price_fit(numeric) SET search_path = public, pg_temp;
ALTER FUNCTION public.merch_signal_score(numeric, numeric) SET search_path = public, pg_temp;
ALTER FUNCTION public.score_business_product(numeric, numeric, boolean, text, text, text) SET search_path = public, pg_temp;

-- 2. Views run with the querying user's permissions
ALTER VIEW public.home_showcase_candidates SET (security_invoker = true);
ALTER VIEW public.ai_pulse_digest_candidates SET (security_invoker = true);

-- 3. Trigger function must never be callable directly
REVOKE EXECUTE ON FUNCTION public.audit_spend_cap_change() FROM PUBLIC, anon, authenticated;

-- 4. Newsletter interests: private definer impl + public invoker wrapper
CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.set_newsletter_interests_impl(
  _subscriber_id uuid, _email text, _categories text[]
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
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
$$;

REVOKE EXECUTE ON FUNCTION private.set_newsletter_interests_impl(uuid, text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.set_newsletter_interests_impl(uuid, text, text[]) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_newsletter_interests(
  _subscriber_id uuid, _email text, _categories text[]
) RETURNS boolean
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT private.set_newsletter_interests_impl(_subscriber_id, _email, _categories);
$$;

GRANT EXECUTE ON FUNCTION public.set_newsletter_interests(uuid, text, text[]) TO anon, authenticated, service_role;

-- 5. Engine Room snapshot: move definer body into private, keep public invoker wrapper
DO $mig$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'engine_room_snapshot';

  v_def := replace(v_def, 'FUNCTION public.engine_room_snapshot()', 'FUNCTION private.engine_room_snapshot_impl()');
  EXECUTE v_def;
END
$mig$;

REVOKE EXECUTE ON FUNCTION private.engine_room_snapshot_impl() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.engine_room_snapshot_impl() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.engine_room_snapshot()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT private.engine_room_snapshot_impl();
$$;

GRANT EXECUTE ON FUNCTION public.engine_room_snapshot() TO authenticated, service_role;