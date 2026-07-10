
-- 1. Lock down SECURITY DEFINER function EXECUTE grants
REVOKE ALL ON FUNCTION public.log_order_changes() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_product_admin_view() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
-- has_role still needs EXECUTE by authenticated because RLS policies invoke it
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_product_admin_view() TO authenticated, service_role;

-- 2. Revoke anon SELECT on admin/private tables that shouldn't appear in GraphQL for logged-out users
REVOKE SELECT ON public.order_audit_log FROM anon;
REVOKE SELECT ON public.store_settings FROM anon;

-- 3. Revoke authenticated SELECT on admin-only tables (admins go through service_role or specific policies)
REVOKE SELECT ON public.sync_logs FROM authenticated;
REVOKE SELECT ON public.automation_events FROM authenticated;
REVOKE SELECT ON public.newsletter_campaigns FROM authenticated;
REVOKE SELECT ON public.product_costs FROM authenticated;
REVOKE SELECT ON public.user_roles FROM authenticated;

-- 4. Tighten newsletter signup: require basic email format
DROP POLICY IF EXISTS "Anyone can subscribe" ON public.newsletter_subscribers;
CREATE POLICY "Anyone can subscribe"
  ON public.newsletter_subscribers
  FOR INSERT
  WITH CHECK (
    email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
    AND length(email) BETWEEN 5 AND 254
    AND (user_id IS NULL OR user_id = auth.uid())
  );
