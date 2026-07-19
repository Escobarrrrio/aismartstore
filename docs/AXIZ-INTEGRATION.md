# Axiz Distributor Integration

Axiz is our South African tech distributor. The `axiz-sync` edge function pulls
their full product catalogue, applies a configurable markup (default 17%), and
keeps pricing, stock, images, and audience tags in sync with the storefront.

## Status

**Live and connected.** The integration has been running end-to-end against the
production Axiz API. The most recent successful run completed on
**2026-07-10** with `catalog_complete` status and **153,176 products** synced.

The function:

- Reads OAuth credentials from Supabase secrets (`AXIZ_CLIENT_ID`,
  `AXIZ_CLIENT_SECRET`, `AXIZ_SCOPE`)
- Mints a token against `identity.goaxiz.co.za/connect/token`
- Pages through `SearchPriceList` in 1,000-item chunks, 8 pages per invocation
- Persists a cursor (`axiz_sync_cursor` in `store_settings`) so long runs
  resume where the previous invocation stopped — safe to re-trigger
- Writes each page to the DB immediately so progress survives timeouts
- Upserts on `sku` into `products`, isolates raw cost in `product_costs`
- Applies markup: `price = cost * (1 + markup_pct/100)`
- Filters out placeholder / blocklisted images
- Logs every run to `sync_logs`

## Audience & price-cap tuning

Every synced row is tagged with an `audience` value based on the marked-up
selling price:

- `price <= R15,000` → `audience = 'residential'` (surfaces on the main
  storefront and home page "AI Picks")
- `price >  R15,000` → `audience = 'business'` (surfaces on `/procurement`,
  the business / government procurement portal)

The cut-off matches the household-budget bar used across the home page and
`search_products` RPC. If the cap needs to change, update it in three places:

1. `supabase/functions/axiz-sync/index.ts` (row mapping)
2. `src/pages/Index.tsx` (`.lte("price", 15000)` on the AI Picks query)
3. `src/contexts/ProductContext.tsx` (`addProducts` bulk-import default)

There is also a backend helper, `public.backfill_audience_batch(batch_size,
price_cap)`, that re-tags existing rows in small batches — useful after a
cap change or after a bulk import from a different source.

## Related tables

- `products` — public catalogue rows (price includes markup, tagged with
  `audience`, `is_ai_product`, `is_active`)
- `product_costs` — raw cost prices; visible only to admins
- `sync_logs` — full audit trail of every run
- `store_settings` — `axiz_markup_pct`, `axiz_markets`, `axiz_brand_filter`,
  `axiz_sync_cursor`
- `image_blocklist` — URLs of known placeholder / broken images; the sync
  refuses to publish products whose primary image matches

## Scheduling

Recommended: daily at 02:00 SAST via `pg_cron`, calling the function with
the `x-internal-secret: <INTERNAL_CRON_SECRET>` header so it bypasses the
admin-role check.

## Guarantees

- Idempotent — safe to re-run
- Non-destructive — products with missing/blocked images or zero cost are
  marked `is_active = false` instead of deleted
- Auditable — every run has a `sync_logs` row with counts, cursor, and errors
- Resumable — the cursor design means a killed invocation loses at most one
  in-flight page
