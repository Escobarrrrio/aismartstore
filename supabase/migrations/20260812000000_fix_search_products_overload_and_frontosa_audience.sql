-- 1. Drop the stale pre-audience search_products overload.
--
-- Two versions of search_products existed: the original 10-arg one and the
-- current 11-arg one with filter_audience (default 'residential'). Any
-- caller that omits filter_audience -- named-parameter calls in particular,
-- which is exactly what Catalog Health's probes and PostgREST's RPC
-- endpoint both do -- matches both overloads via defaults, and Postgres
-- refuses to guess: "Could not choose the best candidate function". The
-- storefront never hit this because Products.tsx always passes
-- filter_audience explicitly, but it broke Catalog Health outright and was
-- a live landmine for every other caller. The 10-arg version also predates
-- the audience column entirely -- it returns every active product
-- regardless of audience, which is exactly the bug audience filtering
-- exists to prevent. Dropped, not kept as a compatibility shim.
DROP FUNCTION IF EXISTS public.search_products(
  text, text, text, boolean, boolean, numeric, numeric, text, integer, integer
);

-- 2. Backfill audience on existing Frontosa products.
--
-- frontosa-sync's stock-mode upsert never set `audience` at all (see the
-- accompanying code fix), so it stayed at the products table's default of
-- 'business' for every row -- all 744 active Frontosa products were
-- reachable only via the Business Portal / ?audience=all, invisible on the
-- default residential storefront view. Same split axiz-sync already uses:
-- R15k cutoff, R25k for laptops (whose realistic consumer price floor sits
-- well above a flat R15k line).
UPDATE public.products
SET audience = CASE
  WHEN price <= (CASE WHEN category ~* 'laptop' THEN 25000 ELSE 15000 END) THEN 'residential'
  ELSE 'business'
END
WHERE sku LIKE 'FR-%' AND is_active;
