
-- 1. notifications: add user_id + user-scoped policy
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id);
DROP POLICY IF EXISTS "Users can view own notifications" ON public.notifications;
CREATE POLICY "Users can view own notifications" ON public.notifications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Users can update own notifications read state" ON public.notifications;
CREATE POLICY "Users can update own notifications read state" ON public.notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 2. order_items: admin update/delete
DROP POLICY IF EXISTS "Admins can update order items" ON public.order_items;
CREATE POLICY "Admins can update order items" ON public.order_items
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS "Admins can delete order items" ON public.order_items;
CREATE POLICY "Admins can delete order items" ON public.order_items
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 3. orders: require authenticated + validation
DROP POLICY IF EXISTS "Anyone can create orders" ON public.orders;
CREATE POLICY "Authenticated users can create their own orders" ON public.orders
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND length(coalesce(customer_name,'')) BETWEEN 2 AND 200
    AND customer_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    AND length(coalesce(customer_email,'')) <= 320
    AND length(coalesce(customer_phone,'')) BETWEEN 5 AND 40
    AND length(coalesce(address,'')) BETWEEN 3 AND 500
    AND length(coalesce(city,'')) BETWEEN 2 AND 120
    AND length(coalesce(postal_code,'')) BETWEEN 3 AND 20
    AND total_amount > 0
    AND total_amount < 10000000
  );

-- 4. quote_requests: stronger validation
DROP POLICY IF EXISTS "Anyone can submit a quote request" ON public.quote_requests;
CREATE POLICY "Anyone can submit a validated quote request" ON public.quote_requests
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    length(coalesce(organisation_name,'')) BETWEEN 2 AND 200
    AND length(coalesce(contact_name,'')) BETWEEN 2 AND 120
    AND email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    AND length(email) BETWEEN 5 AND 320
    AND length(requirements) BETWEEN 10 AND 5000
    AND entity_type IN ('private','public','ngo','education','government','sme','enterprise')
    AND (estimated_value IS NULL OR (estimated_value >= 0 AND estimated_value < 1000000000))
    AND (phone IS NULL OR length(phone) BETWEEN 5 AND 40)
  );

-- 5. GraphQL exposure: revoke SELECT on internal tables
REVOKE SELECT ON public.email_send_log FROM anon, authenticated;
REVOKE SELECT ON public.email_send_state FROM anon, authenticated;
REVOKE SELECT ON public.email_unsubscribe_tokens FROM anon, authenticated;
REVOKE SELECT ON public.suppressed_emails FROM anon, authenticated;
REVOKE SELECT ON public.order_audit_log FROM anon, authenticated;
REVOKE SELECT ON public.store_settings FROM anon, authenticated;

-- 6. SECURITY DEFINER function EXECUTE + search_path
-- Revoke EXECUTE on internal helpers from anon and authenticated
REVOKE EXECUTE ON FUNCTION public.delete_email(text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.email_queue_dispatch() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.email_queue_wake() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_order_changes() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_product_admin_view() FROM PUBLIC, anon;

-- Pin search_path on functions lacking it
ALTER FUNCTION public.delete_email(text, bigint) SET search_path = public;
ALTER FUNCTION public.enqueue_email(text, jsonb) SET search_path = public;
ALTER FUNCTION public.read_email_batch(text, integer, integer) SET search_path = public;
ALTER FUNCTION public.move_to_dlq(text, text, bigint, jsonb) SET search_path = public;
