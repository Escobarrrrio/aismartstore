-- ===========================================================================
-- Stop axiz-sync losing product updates to statement timeouts
-- ===========================================================================
--
-- SYMPTOM
-- -------
-- Every second or third scheduled run (*/15) finished `partial`, with
-- `items_failed` in the hundreds and this in error_details:
--
--   upsert: canceling statement due to statement timeout
--
-- Each failure silently dropped a 500-row batch of supplier prices and stock
-- levels, so the storefront was showing stale availability against Axiz.
--
-- WHAT IT WAS NOT
-- ---------------
-- Two plausible suspects were measured and cleared before this fix:
--
--   * The canonical-category classifier trigger. Timed over 2 000 real rows:
--     247ms total, 0.12ms/row, so roughly 24ms per 150-row batch. Not it.
--   * Batch size. An earlier attempt split the upsert into smaller batches
--     and redeployed. The timeouts came back unchanged, which is the clue
--     that mattered -- a size-independent failure is a *time budget* problem,
--     not a work-per-statement problem.
--
-- WHAT IT WAS
-- -----------
-- PostgREST does not connect as `service_role`. It logs in as `authenticator`
-- and then issues `SET ROLE service_role` per request. `authenticator` carries
--
--   statement_timeout = 8s
--
-- and an edge function calling with the service-role key inherits it, because
-- the login role's settings are what the session actually started with. Eight
-- seconds is a sane budget for a browser request and far too short for an
-- upsert of hundreds of rows into a table with 20 indexes, four of them GIN.
--
-- THE FIX, AND WHY IT IS NOT APPLIED TO `authenticator`
-- -----------------------------------------------------
-- The budget is raised on `service_role` only. Raising it on `authenticator`
-- would have been one line shorter and is the obvious-looking fix, but every
-- anonymous visitor's request also arrives through `authenticator` -- so that
-- version of this change would hand any unauthenticated caller a 120-second
-- statement budget. That is a denial-of-service lever pointed at our own
-- database: a handful of deliberately expensive public queries would hold
-- connections for two minutes each and exhaust the pool.
--
-- So the timeouts stay tiered by who is asking:
--
--   anon           3s    public, untrusted, cheapest queries only
--   authenticated  8s    logged-in shoppers
--   authenticator  8s    the login role -- deliberately left alone
--   service_role   120s  our own server-side jobs, never reachable from a browser
--
-- `lock_timeout` is set alongside it so a batch that cannot get its row locks
-- fails fast and gets retried on the next run, rather than sitting on the
-- 120-second budget waiting for a lock it is never going to win.
--
-- INDEX PRUNING (the same failure, approached from the other side)
-- ---------------------------------------------------------------
-- `products` carries 153 196 rows across 22 indexes totalling 340MB, and every
-- upserted row pays the write cost of all of them. Three were dead weight:
--
--   idx_products_name_trgm     92MB GIN, 1 scan in the lifetime of the stats --
--                              an exact duplicate of products_name_trgm_idx
--                              (91MB, 53 scans), which is kept.
--   idx_products_category_id   0 scans; idx_products_category covers the same
--                              column.
--   idx_products_brand_trgm    9MB GIN, 0 scans. Nothing can use it: brand
--                              filtering in get_facet_counts is an equality
--                              match on lower(brand), and no query in the
--                              codebase does a trigram or ILIKE match on brand.
--
-- Dropping the first two took the table from 340MB to 244MB. GIN indexes are
-- the expensive ones to write, which is why the two trigram drops matter more
-- than their share of the byte count suggests.
--
-- These three were already dropped directly against production while
-- diagnosing this; the statements below are idempotent, so this migration is a
-- no-op there and reproduces the state anywhere else.
-- ===========================================================================

DROP INDEX IF EXISTS public.idx_products_name_trgm;
DROP INDEX IF EXISTS public.idx_products_category_id;
DROP INDEX IF EXISTS public.idx_products_brand_trgm;

-- Role settings are per-cluster, not per-schema, and `service_role` only exists
-- on Supabase. Guarded so a plain Postgres target (local dev, CI) applies the
-- rest of the migration instead of failing on a role it has never heard of.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'ALTER ROLE service_role SET statement_timeout = ''120s''';
    EXECUTE 'ALTER ROLE service_role SET lock_timeout = ''30s''';
  END IF;
EXCEPTION
  WHEN insufficient_privilege THEN
    -- A migration runner without CREATEROLE cannot set this. Say so loudly in
    -- the log rather than failing the deploy: everything above still applies,
    -- and the timeout can be set once by hand.
    RAISE WARNING 'Could not raise service_role statement_timeout (insufficient privilege). Apply manually: ALTER ROLE service_role SET statement_timeout = ''120s'';';
END $$;

-- Tell PostgREST to re-read role settings. Without this the change only takes
-- effect whenever the connection pool happens to recycle.
NOTIFY pgrst, 'reload config';
