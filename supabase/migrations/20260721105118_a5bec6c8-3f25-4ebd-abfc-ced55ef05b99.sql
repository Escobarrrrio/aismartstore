
CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.get_newsletter_subscriber_count_impl()
RETURNS bigint
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT count(*)::bigint FROM public.newsletter_subscribers;
$$;

REVOKE ALL ON FUNCTION private.get_newsletter_subscriber_count_impl() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_newsletter_subscriber_count()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT private.get_newsletter_subscriber_count_impl();
$$;

REVOKE ALL ON FUNCTION public.get_newsletter_subscriber_count() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_newsletter_subscriber_count() TO anon, authenticated, service_role;
