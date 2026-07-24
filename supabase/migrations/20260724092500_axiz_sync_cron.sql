-- Schedule axiz-sync every 15 minutes.
-- axiz-sync is cursor-based and resumable (see axiz_sync_cursor in
-- store_settings): each invocation processes up to 8 pages of 1000
-- products, then either advances the cursor or, on completing a full
-- catalog pass, resets it to "0:0" so the next call naturally starts a
-- fresh pass. Previously this only ran when an admin clicked "Run Axiz
-- sync" in Admin -> Sync Logs (which loops client-side to the same
-- effect) -- with no cron, the catalog only refreshed on a manual visit.
-- At ~15 invocations per full pass this gives a handful of complete
-- refreshes per day. Reuses the same vault-stored service-role key
-- sync-courier-tracking's cron already uses.
-- To revert: SELECT cron.unschedule('axiz-sync');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'axiz-sync'
  ) THEN
    PERFORM cron.schedule(
      'axiz-sync', '*/15 * * * *',
      $cron$
      SELECT net.http_post(
        url := 'https://xwiqubcilptxzvdigsmp.supabase.co/functions/v1/axiz-sync',
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
