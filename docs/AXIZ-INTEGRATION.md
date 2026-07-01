# Axiz Distributor Integration

Axiz is our South African tech distributor. The integration lets the store
automatically ingest their product catalogue, apply a configurable markup
(default 26%), and keep stock levels and pricing in sync.

## Status

**Scaffold complete — awaiting Axiz API credentials.**

The edge function `axiz-sync` is deployed and wired end-to-end:

- Reads `axiz_api_key` and `axiz_markup_pct` from `store_settings`
- Writes to `sync_logs` on every run (running / success / skipped / failed)
- Upserts into `products` on `sku`
- Stores raw cost in `product_costs` (isolated table protected by RLS)
- Applies markup: `price = cost * (1 + markup_pct/100)`

The only piece that isn't real yet is `fetchAxizCatalog()`, because Axiz
has not published API documentation to us. It currently throws a clear
error so the sync_logs row records "not implemented" instead of silently
succeeding.

## Enabling the integration (once credentials arrive)

1. In the Admin Control Centre → **Settings → Axiz Distributor**, paste:
   - **API Key** → stored as `axiz_api_key`
   - **Markup %** → stored as `axiz_markup_pct`
2. Replace the body of `fetchAxizCatalog()` in
   `supabase/functions/axiz-sync/index.ts` with a real `fetch()` call
   against the Axiz endpoint, using their documented auth scheme.
3. Trigger a manual sync from the Command Centre (**Resync Axiz** quick
   action) to verify.
4. Schedule via `pg_cron` — recommend daily 02:00 SAST:

```sql
select cron.schedule(
  'axiz-nightly-sync', '0 0 * * *',
  $$ select net.http_post(
       url := 'https://<project>.supabase.co/functions/v1/axiz-sync',
       headers := jsonb_build_object('Authorization', 'Bearer <SERVICE_ROLE>')
     ); $$
);
```

## What the sync guarantees

- Idempotent: safe to run every hour if desired
- Non-destructive: never deletes existing products (marks `is_active=false`
  if SKU disappears)
- Auditable: every run has a `sync_logs` row with counts and errors
- Non-blocking: if the API is down, the run fails cleanly and the next
  run picks up where it left off

## Related tables

- `products` — public catalogue rows (price includes markup)
- `product_costs` — raw cost prices; visible only to admins
- `sync_logs` — full audit trail
- `store_settings` — API key + markup config
