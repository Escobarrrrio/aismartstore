-- 1. Visitor analytics storage. The admin Analytics screen and the
-- track-pageview edge function were both shipped, but the table they depend
-- on was never created in this database, so every pageview beacon failed and
-- the dashboard had nothing to read. Includes `city`, which track-pageview
-- has always sent (from Vercel's geo headers) and AnalyticsModule renders.
CREATE TABLE IF NOT EXISTS public.page_views (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  path text NOT NULL,
  source text NOT NULL DEFAULT 'direct',
  device_type text NOT NULL DEFAULT 'desktop',
  country text,
  city text,
  session_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.page_views ADD COLUMN IF NOT EXISTS city text;

CREATE INDEX IF NOT EXISTS page_views_created_at_idx ON public.page_views (created_at);
CREATE INDEX IF NOT EXISTS page_views_path_idx ON public.page_views (path);
CREATE INDEX IF NOT EXISTS page_views_source_idx ON public.page_views (source);
CREATE INDEX IF NOT EXISTS page_views_session_idx ON public.page_views (session_id);

-- Deliberately no policies: the only writer is the track-pageview edge
-- function (service role) and the only readers are the admin-gated
-- SECURITY DEFINER functions below.
ALTER TABLE public.page_views ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.page_views TO service_role;

CREATE OR REPLACE FUNCTION public.retention_sweep_page_views(p_older_than interval DEFAULT interval '180 days')
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_deleted bigint;
BEGIN
  DELETE FROM public.page_views WHERE created_at < now() - p_older_than;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END $$;
REVOKE ALL ON FUNCTION public.retention_sweep_page_views(interval) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_analytics_overview(
  p_since timestamptz DEFAULT now() - interval '30 days',
  p_until timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  SELECT jsonb_build_object(
    'since', p_since,
    'until', p_until,
    'generated_at', now(),
    'total_visitors', (SELECT count(DISTINCT session_id) FROM public.page_views WHERE created_at BETWEEN p_since AND p_until),
    'total_pageviews', (SELECT count(*) FROM public.page_views WHERE created_at BETWEEN p_since AND p_until),
    'sources', (SELECT coalesce(jsonb_agg(row_to_json(s)), '[]'::jsonb) FROM (
        SELECT source, count(DISTINCT session_id) AS visitors FROM public.page_views
         WHERE created_at BETWEEN p_since AND p_until GROUP BY source ORDER BY visitors DESC LIMIT 10) s),
    'pages', (SELECT coalesce(jsonb_agg(row_to_json(p)), '[]'::jsonb) FROM (
        SELECT path, count(DISTINCT session_id) AS visitors FROM public.page_views
         WHERE created_at BETWEEN p_since AND p_until GROUP BY path ORDER BY visitors DESC LIMIT 10) p),
    'devices', (SELECT coalesce(jsonb_agg(row_to_json(d)), '[]'::jsonb) FROM (
        SELECT device_type, count(DISTINCT session_id) AS visitors FROM public.page_views
         WHERE created_at BETWEEN p_since AND p_until GROUP BY device_type ORDER BY visitors DESC) d),
    'countries', (SELECT coalesce(jsonb_agg(row_to_json(c)), '[]'::jsonb) FROM (
        SELECT coalesce(country, 'Unknown') AS country, count(DISTINCT session_id) AS visitors FROM public.page_views
         WHERE created_at BETWEEN p_since AND p_until GROUP BY coalesce(country, 'Unknown') ORDER BY visitors DESC LIMIT 10) c),
    'cities', (SELECT coalesce(jsonb_agg(row_to_json(ci)), '[]'::jsonb) FROM (
        SELECT coalesce(city, 'Unknown') AS city, count(DISTINCT session_id) AS visitors FROM public.page_views
         WHERE created_at BETWEEN p_since AND p_until GROUP BY coalesce(city, 'Unknown') ORDER BY visitors DESC LIMIT 10) ci)
  ) INTO v;

  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.admin_analytics_overview(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_analytics_overview(timestamptz, timestamptz) TO authenticated;

-- Admin Users + Newsletter subscriber screens (same missing migration).
CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  SELECT coalesce(jsonb_agg(row_to_json(u) ORDER BY u.created_at DESC), '[]'::jsonb) INTO v
  FROM (
    SELECT au.id, au.email, au.created_at, au.last_sign_in_at,
      (au.email_confirmed_at IS NOT NULL) AS email_confirmed,
      coalesce(au.raw_app_meta_data ->> 'provider', 'email') AS provider,
      p.name, p.customer_type, p.phone,
      EXISTS(SELECT 1 FROM public.user_roles ur WHERE ur.user_id = au.id AND ur.role = 'admin'::app_role) AS is_admin,
      (SELECT count(*) FROM public.orders o WHERE o.user_id = au.id) AS order_count
    FROM auth.users au
    LEFT JOIN public.profiles p ON p.user_id = au.id
  ) u;

  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.admin_list_users() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_newsletter_subscribers()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  SELECT coalesce(jsonb_agg(row_to_json(s) ORDER BY s.subscribed_at DESC), '[]'::jsonb) INTO v
  FROM (
    SELECT id, email, name, source, interested_categories, subscribed_at, unsubscribed_at
      FROM public.newsletter_subscribers
  ) s;

  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.admin_list_newsletter_subscribers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_newsletter_subscribers() TO authenticated;

-- 2. Newsletter subscriber count: the public wrapper is callable but the
-- private implementation it delegates to was never granted to anon, so the
-- signup form's social-proof count failed with "permission denied".
GRANT USAGE ON SCHEMA private TO anon, authenticated;
GRANT EXECUTE ON FUNCTION private.get_newsletter_subscriber_count_impl() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_newsletter_subscriber_count() TO anon, authenticated, service_role;