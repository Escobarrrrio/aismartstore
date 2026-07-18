
-- Fix 1: Signed-in users can execute SECURITY DEFINER functions
-- Revoke EXECUTE from public/authenticated for internal helpers; switch admin view to INVOKER.

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon, authenticated;

ALTER FUNCTION public.get_product_admin_view() SECURITY INVOKER;
REVOKE EXECUTE ON FUNCTION public.get_product_admin_view() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_product_admin_view() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_compliance_pack(uuid, text) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.get_compliance_pack(uuid, text) TO anon;

-- Fix 2: Welcome email — trigger server-side after subscription instead of via
-- public callable endpoint. The Edge Function is now invoked via a DB trigger
-- using the internal service role JWT; direct client calls will be rejected.

CREATE OR REPLACE FUNCTION public.trigger_welcome_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  BEGIN
    PERFORM net.http_post(
      url := 'https://xwiqubcilptxzvdigsmp.supabase.co/functions/v1/send-welcome-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key'
        )
      ),
      body := jsonb_build_object('subscriber_id', NEW.id::text)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trigger_welcome_email failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS newsletter_welcome_email ON public.newsletter_subscribers;
CREATE TRIGGER newsletter_welcome_email
  AFTER INSERT ON public.newsletter_subscribers
  FOR EACH ROW EXECUTE FUNCTION public.trigger_welcome_email();
