-- Found while testing sync-competitor-prices' own cron trigger: EVERY cron
-- job that calls invoke_edge_function(..., 'service') has been silently
-- getting a 403 "Admin role required" back and never actually running.
--
-- Root cause: 'service' mode sends the Authorization header from vault
-- secret `email_queue_service_role_key`, and that value does not match
-- this project's real SUPABASE_SERVICE_ROLE_KEY (almost certainly a
-- leftover from the schema-dump/restore migration off the old Lovable
-- project -- the vault secret NAME carried over, but its VALUE didn't get
-- updated to the new project's actual key). Every affected function's own
-- code falls through to requiring a real admin session, which a cron job
-- obviously doesn't have, so it 403s -- silently: the auth check happens
-- before startRun(), so no sync_logs row is even written, which is why
-- this was invisible to the alerting system already built for this store.
--
-- Confirmed by direct test (net._http_response): axiz-sync,
-- cleanup-blocked-products, engine-room-analyst and sync-courier-tracking
-- have been 403ing on every single cron tick. axiz-sync runs every 15
-- minutes, so this has meant the distributor price/stock sync has not
-- been running unattended at all -- only when manually triggered.
--
-- 'internal' mode (x-internal-secret from vault secret internal_cron_secret,
-- checked against each function's own INTERNAL_CRON_SECRET env var) is
-- proven working right now (stock-sanity-check-hourly uses it and succeeds
-- every run) and every affected function already supports it. Rather than
-- touch the real service-role secret, switching these jobs to the
-- already-working 'internal' path fixes this without handling that key at
-- all.
--
-- The gateway side of the fix (verify_jwt: false on each affected function,
-- so a bare x-internal-secret header isn't rejected before the function's
-- own code ever sees it) was applied via deploy_edge_function and isn't
-- representable in a SQL migration -- see the corresponding admin note.
SELECT cron.schedule('axiz-sync', '*/15 * * * *',
  $cron$ SELECT public.invoke_edge_function('axiz-sync', '{}'::jsonb, 'internal'); $cron$);

SELECT cron.schedule('cleanup-blocked-products-daily', '0 4 * * *',
  $cron$ SELECT public.invoke_edge_function('cleanup-blocked-products', '{}'::jsonb, 'internal'); $cron$);

SELECT cron.schedule('engine-room-watch', '25 */3 * * *',
  $cron$ SELECT public.invoke_edge_function('engine-room-analyst', '{}'::jsonb, 'internal'); $cron$);

SELECT cron.schedule('sync-courier-tracking', '*/30 * * * *',
  $cron$ SELECT public.invoke_edge_function('sync-courier-tracking', '{}'::jsonb, 'internal'); $cron$);

-- New job from this same session -- create it already using the working
-- mode instead of shipping it broken and finding out the same way.
SELECT cron.schedule('sync-competitor-prices-daily', '0 5 * * *',
  $cron$ SELECT public.invoke_edge_function('sync-competitor-prices', '{}'::jsonb, 'internal'); $cron$);
