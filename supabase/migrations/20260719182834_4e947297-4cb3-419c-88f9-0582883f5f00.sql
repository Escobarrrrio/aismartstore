
-- Lock down SECURITY DEFINER functions per linter warnings.
-- Keep intentional grants: has_role (authenticated, needed by RLS),
-- get_compliance_pack (authenticated, shopper quote unlock),
-- get_product_admin_view (authenticated, admin panel; internal role check inside).

REVOKE EXECUTE ON FUNCTION public.trigger_welcome_email() FROM PUBLIC;

-- Anon should never call any of these SECURITY DEFINER helpers.
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_compliance_pack(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_product_admin_view() FROM anon;

-- Revoke authenticated EXECUTE from all other SECURITY DEFINER functions
-- (trigger functions, cron/queue helpers, batch maintenance procs).
REVOKE EXECUTE ON FUNCTION public.backfill_audience_batch(integer, numeric) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.business_signup_rate_limit() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.deactivate_blocked_products_batch(integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_email(text, bigint) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.email_queue_dispatch() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.email_queue_wake() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_image_blocklist() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_order_changes() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_quote_request_submitted() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recategorize_batch(integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_product_facets_cache() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trigger_welcome_email() FROM anon, authenticated;
