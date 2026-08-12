-- ===========================================================================
-- Two email-dispatch paths have been silently posting to a project this
-- store hasn't run on since the migration off Lovable Cloud
-- ===========================================================================
--
-- trigger_welcome_email() (AFTER INSERT on newsletter_subscribers) hardcoded:
--   url := 'https://xwiqubcilptxzvdigsmp.supabase.co/functions/v1/send-welcome-email'
-- with no fallback at all -- every newsletter signup has been silently
-- failing to send its welcome email. The failure is swallowed by its own
-- `EXCEPTION WHEN OTHERS THEN RAISE WARNING`, so nothing visible ever
-- surfaced it: the subscriber row is still created, the signup form still
-- looks like it worked.
--
-- dispatch_ai_pulse_digest() (the daily 03:30 UTC cron job
-- 'ai-pulse-daily-digest') was already built defensively -- it constructs
-- the URL from `store_settings.supabase_project_ref` and only falls back to
-- the same dead URL if that setting is missing. It was missing: this
-- database has never had a `supabase_project_ref` row, so the fallback has
-- been live the entire time this cron job has been scheduled.
--
-- FIX
-- ---
-- 1. Seed store_settings.supabase_project_ref with the real project ref, so
--    dispatch_ai_pulse_digest's own dynamic-URL logic starts working with no
--    code change.
-- 2. Rewrite trigger_welcome_email to use the exact same
--    store_settings-driven pattern instead of a bare hardcoded string, so
--    the next platform migration only has to update one setting, not go
--    hunting through function bodies for a literal URL again.
-- ===========================================================================

INSERT INTO public.store_settings (key, value)
VALUES ('supabase_project_ref', 'okejdzkftwhccplyfluf')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

CREATE OR REPLACE FUNCTION public.trigger_welcome_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_url text;
BEGIN
  BEGIN
    SELECT 'https://' || (SELECT value FROM public.store_settings WHERE key = 'supabase_project_ref')
           || '.supabase.co/functions/v1/send-welcome-email'
      INTO v_url;
    IF v_url IS NULL OR v_url LIKE 'https://.%' THEN
      -- Same last-resort fallback dispatch_ai_pulse_digest uses -- the
      -- *current* project, not the pre-migration one, so a missing setting
      -- degrades to "still works" instead of "silently posts nowhere".
      v_url := 'https://okejdzkftwhccplyfluf.supabase.co/functions/v1/send-welcome-email';
    END IF;

    PERFORM net.http_post(
      url := v_url,
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
$function$;
