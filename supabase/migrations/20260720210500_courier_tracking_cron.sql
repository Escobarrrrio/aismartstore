-- Schedule sync-courier-tracking every 30 minutes.
-- Phase A pulls tracking numbers from The Courier Guy (Shiplogic) API for
-- paid orders; Phase B emails customers a branded shipping notification
-- exactly once per order (deduped in email_send_log). Reuses the existing
-- vault-stored service-role key that process-email-queue's cron uses.
-- To revert: SELECT cron.unschedule('sync-courier-tracking');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'sync-courier-tracking'
  ) THEN
    PERFORM cron.schedule(
      'sync-courier-tracking', '*/30 * * * *',
      $cron$
      SELECT net.http_post(
        url := 'https://xwiqubcilptxzvdigsmp.supabase.co/functions/v1/sync-courier-tracking',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (
            SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key'
          )
        ),
        body := '{}'::jsonb
      );
      $cron$
    );
  END IF;
END $$;
