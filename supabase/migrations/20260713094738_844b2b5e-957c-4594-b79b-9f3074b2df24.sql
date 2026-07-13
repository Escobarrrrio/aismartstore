
-- 1) Revoke EXECUTE on internal trigger/SECURITY DEFINER functions from public roles
REVOKE EXECUTE ON FUNCTION public.business_signup_rate_limit() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_quote_request_submitted() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_order_changes() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_image_blocklist() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.email_queue_wake() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.email_queue_dispatch() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_product_facets_cache() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.deactivate_blocked_products_batch(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_email(text, bigint) FROM PUBLIC, anon, authenticated;

-- 2) Tighten business_signups INSERT policy (remove `WITH CHECK (true)`)
DROP POLICY IF EXISTS "Anyone can submit a business signup" ON public.business_signups;
CREATE POLICY "Anyone can submit a business signup"
  ON public.business_signups
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    (honeypot_flag IS NULL OR honeypot_flag = false)
    AND work_email IS NOT NULL
    AND position('@' in work_email) > 1
  );

-- 3) Explicitly scope service-role-only email tables to service_role
DROP POLICY IF EXISTS "Service role can insert send log" ON public.email_send_log;
DROP POLICY IF EXISTS "Service role can read send log" ON public.email_send_log;
DROP POLICY IF EXISTS "Service role can update send log" ON public.email_send_log;
CREATE POLICY "Service role can insert send log" ON public.email_send_log
  FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "Service role can read send log" ON public.email_send_log
  FOR SELECT TO service_role USING (true);
CREATE POLICY "Service role can update send log" ON public.email_send_log
  FOR UPDATE TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role can manage send state" ON public.email_send_state;
CREATE POLICY "Service role can manage send state" ON public.email_send_state
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role can insert tokens" ON public.email_unsubscribe_tokens;
DROP POLICY IF EXISTS "Service role can mark tokens as used" ON public.email_unsubscribe_tokens;
DROP POLICY IF EXISTS "Service role can read tokens" ON public.email_unsubscribe_tokens;
CREATE POLICY "Service role can insert tokens" ON public.email_unsubscribe_tokens
  FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "Service role can mark tokens as used" ON public.email_unsubscribe_tokens
  FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role can read tokens" ON public.email_unsubscribe_tokens
  FOR SELECT TO service_role USING (true);

DROP POLICY IF EXISTS "Service role can insert suppressed emails" ON public.suppressed_emails;
DROP POLICY IF EXISTS "Service role can read suppressed emails" ON public.suppressed_emails;
CREATE POLICY "Service role can insert suppressed emails" ON public.suppressed_emails
  FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "Service role can read suppressed emails" ON public.suppressed_emails
  FOR SELECT TO service_role USING (true);

-- 4) Defense-in-depth: explicitly revoke anon/public access on product_costs
REVOKE ALL ON public.product_costs FROM PUBLIC, anon;
