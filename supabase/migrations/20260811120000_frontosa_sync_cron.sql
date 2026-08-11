-- Frontosa dealer feed: two schedules, matching Frontosa's own
-- recommended request cadence in their API docs.
--
--   Catalogue (stock_info.asp -- description/brand/category/images):
--   "Once a day between 7:15am and 8am" SAST -> 05:20 UTC.
--
--   Stock (stock.asp -- live price + per-branch quantity): "Once an hour
--   (if necessary) after 10 past the hour", and the feed is rate-limited
--   on Frontosa's side, so :15 past every hour rather than on the hour.
--
-- Both use 'internal' mode from the start -- the 'service' mode vault
-- secret mismatch found and fixed for axiz-sync/cleanup-blocked-products/
-- engine-room-analyst/sync-courier-tracking earlier this session would
-- affect this cron identically if it used the same broken path.
SELECT cron.schedule('frontosa-catalog-daily', '20 5 * * *',
  $cron$ SELECT public.invoke_edge_function('frontosa-sync', '{"mode":"catalog"}'::jsonb, 'internal'); $cron$)
WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'frontosa-catalog-daily');

SELECT cron.schedule('frontosa-stock-hourly', '15 * * * *',
  $cron$ SELECT public.invoke_edge_function('frontosa-sync', '{"mode":"stock"}'::jsonb, 'internal'); $cron$)
WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'frontosa-stock-hourly');
