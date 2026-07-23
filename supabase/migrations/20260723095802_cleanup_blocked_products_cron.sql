-- Schedule cleanup-blocked-products daily. This function already existed
-- with real, working batch-deactivation logic (deactivate_blocked_products_batch)
-- but was never wired to a schedule or an admin button, so blocked-image
-- products silently accumulated instead of being deactivated. Reuses the
-- same vault-stored service-role key sync-courier-tracking's cron uses --
-- cleanup-blocked-products now also accepts that key as a trusted internal
-- caller (see auth check in index.ts), same as the existing internal-secret
-- header path.
-- To revert: SELECT cron.unschedule('cleanup-blocked-products-daily');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'cleanup-blocked-products-daily'
  ) THEN
    PERFORM cron.schedule(
      'cleanup-blocked-products-daily', '0 4 * * *',
      $cron$
      SELECT net.http_post(
        url := 'https://xwiqubcilptxzvdigsmp.supabase.co/functions/v1/cleanup-blocked-products',
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
