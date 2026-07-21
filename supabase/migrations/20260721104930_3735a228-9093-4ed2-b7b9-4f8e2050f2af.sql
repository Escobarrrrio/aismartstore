
-- Newsletter signups: allow anon to insert (RLS policy already covers row validation)
GRANT INSERT ON public.newsletter_subscribers TO anon;
GRANT INSERT, UPDATE ON public.newsletter_subscribers TO authenticated;

-- Public subscriber count endpoint (only returns a number, never emails)
CREATE OR REPLACE FUNCTION public.get_newsletter_subscriber_count()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::bigint FROM public.newsletter_subscribers;
$$;
REVOKE EXECUTE ON FUNCTION public.get_newsletter_subscriber_count() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_newsletter_subscriber_count() TO anon, authenticated;

-- user_roles: authenticated needs SELECT for the "Users can view their own roles" policy to return rows
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
