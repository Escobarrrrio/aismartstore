SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'sync-ai-pulse-every-6h'),
  command := $cmd$
    SELECT net.http_post(
      url := 'https://xwiqubcilptxzvdigsmp.supabase.co/functions/v1/sync-ai-pulse',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-internal-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'internal_cron_secret')
      ),
      body := '{}'::jsonb
    );
  $cmd$
);

SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'sync-exchange-rates-daily'),
  command := $cmd$
    SELECT net.http_post(
      url := 'https://xwiqubcilptxzvdigsmp.supabase.co/functions/v1/sync-exchange-rates',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-internal-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'internal_cron_secret')
      ),
      body := '{}'::jsonb
    );
  $cmd$
);