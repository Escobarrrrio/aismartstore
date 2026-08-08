-- Three admin screens the owner asked for directly: a real visitor-analytics
-- view inside our own Control Centre (the one shown to him previously was
-- Lovable's own dashboard for the now-migrated-away-from project -- it will
-- go stale the moment traffic stops hitting that origin), a Users screen
-- distinct from the existing Customers screen (auth/account-level, not
-- purchase-level), and a newsletter subscriber list on its own screen
-- instead of just a count buried in the campaign composer.
--
-- All three follow the exact pattern already established in
-- 20260805200000_real_command_metrics.sql: SECURITY DEFINER, an explicit
-- has_role() check as the actual gate, REVOKE ALL FROM PUBLIC, anon, and
-- GRANT EXECUTE TO authenticated only -- so a non-admin authenticated
-- customer hits the RAISE EXCEPTION, not a data leak.

-- ------------------------------------------------------------------ tables
-- First-party pageview log. No third-party analytics vendor, no cookie,
-- no cross-site identifier -- an anonymous per-browser id generated and
-- held in localStorage, only ever sent to our own domain, and only after
-- the visitor has accepted the existing cookie-consent banner (see
-- usePageViewTracking.ts). RLS is enabled with zero policies: the only
-- writer is the track-pageview edge function (service role, bypasses RLS
-- by design), and the only readers are the SECURITY DEFINER functions
-- below. Nobody can select or insert this table through the public API.
CREATE TABLE IF NOT EXISTS public.page_views (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  path text NOT NULL,
  source text NOT NULL DEFAULT 'direct',
  device_type text NOT NULL DEFAULT 'desktop',
  country text,
  session_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS page_views_created_at_idx ON public.page_views (created_at);
CREATE INDEX IF NOT EXISTS page_views_path_idx ON public.page_views (path);
CREATE INDEX IF NOT EXISTS page_views_source_idx ON public.page_views (source);
CREATE INDEX IF NOT EXISTS page_views_session_idx ON public.page_views (session_id);

ALTER TABLE public.page_views ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies. See comment above.

-- Retention: a pageview log with no ceiling grows forever for no benefit --
-- nobody is drilling into which anonymous session visited page X fourteen
-- months ago. Reuses the retention_sweep() naming convention already used
-- for security_events/spend_ledger (20260807... in the earlier migration
-- set) rather than inventing a second cleanup mechanism.
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

DO $$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    PERFORM cron.schedule('retention-sweep-page-views', '30 4 * * *',
      'SELECT public.retention_sweep_page_views();');
  END IF;
END $$;

-- --------------------------------------------------------------- analytics
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
    'total_visitors', (
      SELECT count(DISTINCT session_id) FROM public.page_views
       WHERE created_at BETWEEN p_since AND p_until
    ),
    'total_pageviews', (
      SELECT count(*) FROM public.page_views
       WHERE created_at BETWEEN p_since AND p_until
    ),
    'sources', (
      SELECT coalesce(jsonb_agg(row_to_json(s)), '[]'::jsonb) FROM (
        SELECT source, count(DISTINCT session_id) AS visitors
          FROM public.page_views
         WHERE created_at BETWEEN p_since AND p_until
         GROUP BY source ORDER BY visitors DESC LIMIT 10
      ) s
    ),
    'pages', (
      SELECT coalesce(jsonb_agg(row_to_json(p)), '[]'::jsonb) FROM (
        SELECT path, count(DISTINCT session_id) AS visitors
          FROM public.page_views
         WHERE created_at BETWEEN p_since AND p_until
         GROUP BY path ORDER BY visitors DESC LIMIT 10
      ) p
    ),
    'devices', (
      SELECT coalesce(jsonb_agg(row_to_json(d)), '[]'::jsonb) FROM (
        SELECT device_type, count(DISTINCT session_id) AS visitors
          FROM public.page_views
         WHERE created_at BETWEEN p_since AND p_until
         GROUP BY device_type ORDER BY visitors DESC
      ) d
    ),
    'countries', (
      SELECT coalesce(jsonb_agg(row_to_json(c)), '[]'::jsonb) FROM (
        SELECT coalesce(country, 'Unknown') AS country, count(DISTINCT session_id) AS visitors
          FROM public.page_views
         WHERE created_at BETWEEN p_since AND p_until
         GROUP BY coalesce(country, 'Unknown') ORDER BY visitors DESC LIMIT 10
      ) c
    )
  ) INTO v;

  RETURN v;
END $$;

REVOKE ALL ON FUNCTION public.admin_analytics_overview(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_analytics_overview(timestamptz, timestamptz) TO authenticated;

-- ------------------------------------------------------------------- users
-- Distinct from Customers (CustomersModule.tsx, which is purchase-history-
-- centric and reads public.profiles joined with orders). This is the
-- account/auth-level view: every row auth.users actually has, whether or
-- not a profile or an order exists for it, plus role and provider -- the
-- questions "who can sign in" and "who has admin" answer, that "who bought
-- something" does not.
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
    SELECT
      au.id,
      au.email,
      au.created_at,
      au.last_sign_in_at,
      (au.email_confirmed_at IS NOT NULL) AS email_confirmed,
      coalesce(au.raw_app_meta_data ->> 'provider', 'email') AS provider,
      p.name,
      p.customer_type,
      p.phone,
      EXISTS(
        SELECT 1 FROM public.user_roles ur WHERE ur.user_id = au.id AND ur.role = 'admin'::app_role
      ) AS is_admin,
      (SELECT count(*) FROM public.orders o WHERE o.user_id = au.id) AS order_count
    FROM auth.users au
    LEFT JOIN public.profiles p ON p.user_id = au.id
  ) u;

  RETURN v;
END $$;

REVOKE ALL ON FUNCTION public.admin_list_users() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;

-- ------------------------------------------------------------- newsletter
-- The subscriber count already exists inline in NewsletterModule -- this is
-- the actual list behind that number, admin-only (never exposed via a
-- normal RLS-selectable table, since an email list is exactly the kind of
-- thing a scraping bug or an over-broad policy leaks first).
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
