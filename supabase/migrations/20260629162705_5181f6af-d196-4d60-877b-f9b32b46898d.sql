
-- 1. SECURITY DEFINER function execute privileges
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_product_admin_view() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_product_admin_view() TO authenticated, service_role;

-- 2. Revoke anon SELECT on non-public tables (keeps catalog + public read tables exposed)
REVOKE SELECT ON public.addresses, public.ai_conversations, public.automation_events,
  public.newsletter_campaigns, public.newsletter_subscribers, public.notification_preferences,
  public.notifications, public.order_items, public.orders, public.product_costs,
  public.profiles, public.quote_requests, public.returns, public.support_tickets,
  public.sync_logs, public.ticket_messages, public.user_roles, public.wishlist_items
FROM anon;

-- 3. Storage: drop the broad public SELECT policy that allows listing the product-images bucket.
-- Bucket remains public so files are still accessible by direct URL; just no longer enumerable.
DROP POLICY IF EXISTS "Product images are publicly accessible" ON storage.objects;

-- 4. Tighten always-true INSERT WITH CHECK policies
DROP POLICY IF EXISTS "Anyone can create orders" ON public.orders;
CREATE POLICY "Anyone can create orders" ON public.orders
  FOR INSERT TO public
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());

DROP POLICY IF EXISTS "Anyone can create order items" ON public.order_items;
CREATE POLICY "Anyone can create order items" ON public.order_items
  FOR INSERT TO public
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_id
        AND (o.user_id IS NULL OR o.user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Anyone can create conversations" ON public.ai_conversations;
CREATE POLICY "Anyone can create conversations" ON public.ai_conversations
  FOR INSERT TO public
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());

DROP POLICY IF EXISTS "Anyone can submit a quote request" ON public.quote_requests;
CREATE POLICY "Anyone can submit a quote request" ON public.quote_requests
  FOR INSERT TO public
  WITH CHECK (length(email) > 3 AND length(requirements) > 0);

DROP POLICY IF EXISTS "Anyone can subscribe" ON public.newsletter_subscribers;
CREATE POLICY "Anyone can subscribe" ON public.newsletter_subscribers
  FOR INSERT TO public
  WITH CHECK (length(email) > 3 AND (user_id IS NULL OR user_id = auth.uid()));
