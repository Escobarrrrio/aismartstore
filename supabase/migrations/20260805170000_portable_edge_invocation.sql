-- Stop hard-coding the hosting project into the database.
--
-- Thirteen scheduled jobs and two SECURITY DEFINER dispatchers each carried a
-- literal `https://<project-ref>.supabase.co/functions/v1/...` URL. That is
-- fine right up until the database moves, at which point every one of them
-- keeps firing on schedule, keeps recording a queued request, and keeps
-- reaching a project that is no longer serving this store -- silently. The
-- Axiz catalogue sync, the courier tracking sync and the newsletter dispatcher
-- are all in that set, and none of them would have raised an error.
--
-- After this migration the base URL lives in exactly one row of
-- `store_settings`. Moving the database is a one-row UPDATE.
--
-- Also adds the four scheduled jobs that existed only in the live database and
-- had no migration behind them: refresh-product-facets, stock-sanity-check,
-- sync-ai-pulse and sync-exchange-rates.

-- Seeded with the current project so this migration changes no behaviour on
-- the database it is first applied to. The cutover is: update this row.
INSERT INTO public.store_settings (key, value)
VALUES ('functions_base_url', 'https://xwiqubcilptxzvdigsmp.supabase.co/functions/v1')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.functions_base_url()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT rtrim(value, '/') FROM public.store_settings WHERE key = 'functions_base_url'
$$;

/**
 * Posts to one of this project's edge functions.
 *
 * `auth_mode` picks the credential, because the three call sites genuinely
 * differ and getting it wrong is a 401 that only shows up in a log:
 *   'service' - vault service-role key; what most scheduled jobs use
 *   'internal' - the shared internal-cron secret, for functions that check
 *                x-internal-secret instead of a JWT
 *   'none'    - functions deployed with verify_jwt disabled
 *
 * Returns the pg_net request id. Note that pg_net records success when the
 * request is QUEUED, not when it completes -- a non-null return here means
 * "handed off", never "the function ran". Delivery is confirmed in
 * net._http_response, which is what the engine-room watcher reads.
 */
CREATE OR REPLACE FUNCTION public.invoke_edge_function(
  fn_name   text,
  body      jsonb DEFAULT '{}'::jsonb,
  auth_mode text  DEFAULT 'service'
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_base    text := public.functions_base_url();
  v_headers jsonb := jsonb_build_object('Content-Type', 'application/json');
  v_secret  text;
BEGIN
  IF v_base IS NULL OR v_base = '' THEN
    RAISE EXCEPTION 'invoke_edge_function: store_settings.functions_base_url is not set';
  END IF;

  IF auth_mode = 'service' THEN
    SELECT decrypted_secret INTO v_secret
      FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key';
    IF v_secret IS NULL THEN
      RAISE EXCEPTION 'invoke_edge_function(%): vault secret email_queue_service_role_key is missing', fn_name;
    END IF;
    v_headers := v_headers || jsonb_build_object('Authorization', 'Bearer ' || v_secret);

  ELSIF auth_mode = 'internal' THEN
    SELECT decrypted_secret INTO v_secret
      FROM vault.decrypted_secrets WHERE name = 'internal_cron_secret';
    IF v_secret IS NULL THEN
      RAISE EXCEPTION 'invoke_edge_function(%): vault secret internal_cron_secret is missing', fn_name;
    END IF;
    v_headers := v_headers || jsonb_build_object('x-internal-secret', v_secret);

  ELSIF auth_mode <> 'none' THEN
    RAISE EXCEPTION 'invoke_edge_function: unknown auth_mode %', auth_mode;
  END IF;

  RETURN net.http_post(
    url     := v_base || '/' || fn_name,
    headers := v_headers,
    body    := body
  );
END $$;

REVOKE ALL ON FUNCTION public.invoke_edge_function(text, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.functions_base_url() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------ crontab
-- cron.schedule upserts on jobname, so this is the whole schedule, declared in
-- one place, and re-running it is a no-op. Every job routes through the helper,
-- so none of them names a project.
DO $$
DECLARE
  v record;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron not installed; skipping schedule';
    RETURN;
  END IF;

  FOR v IN
    SELECT * FROM (VALUES
      -- name,                            schedule,        function,                  auth
      ('axiz-sync',                       '*/15 * * * *',  'axiz-sync',                'service'),
      ('sync-courier-tracking',           '*/30 * * * *',  'sync-courier-tracking',    'service'),
      ('cleanup-blocked-products-daily',  '0 4 * * *',     'cleanup-blocked-products', 'service'),
      ('sync-ai-pulse-every-6h',          '0 */6 * * *',   'sync-ai-pulse',            'service'),
      ('sync-exchange-rates-daily',       '0 3 * * *',     'sync-exchange-rates',      'service'),
      ('stock-sanity-check-hourly',       '17 * * * *',    'stock-sanity-check',       'internal'),
      ('engine-room-watch',               '25 */3 * * *',  'engine-room-analyst',      'service')
    ) AS t(jobname, sched, fn, auth)
  LOOP
    PERFORM cron.schedule(
      v.jobname, v.sched,
      format('SELECT public.invoke_edge_function(%L, %L::jsonb, %L);', v.fn, '{}', v.auth)
    );
  END LOOP;

  -- Pure-SQL jobs: no edge function, nothing to point anywhere.
  PERFORM cron.schedule('refresh-product-facets', '17 * * * *',
    'SELECT public.refresh_product_facets_cache();');
END $$;
