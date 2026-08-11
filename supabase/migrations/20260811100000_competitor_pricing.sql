-- Competitor price watch: daily SerpAPI (Google Shopping) lookups for a
-- small, admin-curated set of products, surfaced as a suggested market
-- price in Admin -> Sourcing & Pricing. Suggest-only by design -- nothing
-- here writes to products.price on its own; an admin has to look at the
-- number and click Apply.
--
-- Free-tier SerpAPI accounts get 100 searches/month total, so the watchlist
-- is opt-in per product (products.track_competitors) rather than every
-- active product, and the edge function tracks its own monthly spend
-- against a configurable budget (store_settings.serpapi_monthly_budget) so
-- it never blows past the quota partway through the month.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS track_competitors boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS competitor_last_checked timestamptz;

CREATE TABLE IF NOT EXISTS public.competitor_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  competitor_name text NOT NULL,
  price numeric NOT NULL,
  currency text NOT NULL DEFAULT 'ZAR',
  source_url text,
  found_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS competitor_prices_product_found_idx
  ON public.competitor_prices (product_id, found_at DESC);

ALTER TABLE public.competitor_prices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view competitor prices" ON public.competitor_prices;
CREATE POLICY "Admins can view competitor prices"
  ON public.competitor_prices FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- No client insert/update/delete policy -- only the edge function (service
-- role key, bypasses RLS) ever writes rows here.

-- Small allowlist gap found while touching this table: Checkout.tsx reads
-- yoco_enabled off the same public-read path as payfast_enabled, but only
-- payfast_enabled was ever added to the allowlist below -- so RLS silently
-- dropped that one row for every non-admin visitor (no error, just an
-- empty result), meaning the Yoco option could fail to appear at checkout
-- for real shoppers even when it's configured on. Same table, same fix.
DROP POLICY IF EXISTS "Anyone can view public store settings" ON public.store_settings;
CREATE POLICY "Anyone can view public store settings"
  ON public.store_settings FOR SELECT TO public
  USING (key = ANY (ARRAY[
    'shipping_flat_rate', 'free_shipping_threshold', 'shipping_zones', 'shipping_rate_table',
    'dispatch_city', 'payfast_enabled', 'yoco_enabled', 'about_hero_image', 'about_place_image'
  ]));

-- Admin: toggle whether a product is on the competitor watchlist.
CREATE OR REPLACE FUNCTION public.admin_set_competitor_watch(p_product_id uuid, p_watch boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Admin role required';
  END IF;
  UPDATE public.products SET track_competitors = p_watch WHERE id = p_product_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_competitor_watch(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_competitor_watch(uuid, boolean) TO authenticated;

-- Admin: small product search to add something to the watchlist. Sourcing
-- & Pricing is a self-contained screen (no products prop threaded in from
-- Admin.tsx today), so this is its own lightweight lookup rather than
-- shipping the whole catalogue to the page.
CREATE OR REPLACE FUNCTION public.admin_search_products_for_watch(p_query text)
RETURNS TABLE (id uuid, name text, brand text, price numeric, track_competitors boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Admin role required';
  END IF;
  RETURN QUERY
  SELECT p.id, p.name, p.brand, p.price, p.track_competitors
  FROM public.products p
  WHERE p.is_active
    AND (p.name ILIKE '%' || p_query || '%' OR p.brand ILIKE '%' || p_query || '%')
  ORDER BY p.name
  LIMIT 10;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_search_products_for_watch(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_search_products_for_watch(text) TO authenticated;

-- Admin: the watchlist itself, each row with our price/cost, the latest
-- competitor find, and a suggested market price. "Latest" means the most
-- recent find per competitor within the last 30 days, not an unbounded
-- history, so a retailer who quietly de-listed a while back doesn't keep
-- anchoring the average forever.
CREATE OR REPLACE FUNCTION public.admin_competitor_pricing_overview()
RETURNS TABLE (
  product_id uuid,
  name text,
  brand text,
  our_price numeric,
  our_cost numeric,
  competitor_count integer,
  market_min numeric,
  market_avg numeric,
  market_max numeric,
  suggested_price numeric,
  last_checked timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Admin role required';
  END IF;
  RETURN QUERY
  WITH latest AS (
    SELECT DISTINCT ON (cp.product_id, cp.competitor_name)
      cp.product_id, cp.competitor_name, cp.price
    FROM public.competitor_prices cp
    WHERE cp.found_at > now() - interval '30 days'
    ORDER BY cp.product_id, cp.competitor_name, cp.found_at DESC
  ),
  agg AS (
    SELECT l.product_id, count(*)::int AS competitor_count,
           min(l.price) AS market_min, avg(l.price) AS market_avg, max(l.price) AS market_max
    FROM latest l
    GROUP BY l.product_id
  )
  SELECT p.id, p.name, p.brand, p.price, pc.cost_price,
         coalesce(agg.competitor_count, 0), agg.market_min,
         round(agg.market_avg, 2), agg.market_max,
         round(agg.market_avg, 2),
         p.competitor_last_checked
  FROM public.products p
  LEFT JOIN public.product_costs pc ON pc.product_id = p.id
  LEFT JOIN agg ON agg.product_id = p.id
  WHERE p.track_competitors
  ORDER BY p.name;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_competitor_pricing_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_competitor_pricing_overview() TO authenticated;

-- Admin: apply a chosen price. Deliberately separate from the sync -- the
-- sync only ever writes to competitor_prices, never to products.price.
CREATE OR REPLACE FUNCTION public.admin_apply_competitor_price(p_product_id uuid, p_price numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Admin role required';
  END IF;
  IF p_price IS NULL OR p_price <= 0 THEN
    RAISE EXCEPTION 'Price must be a positive number';
  END IF;
  UPDATE public.products SET price = p_price, updated_at = now() WHERE id = p_product_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_apply_competitor_price(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_apply_competitor_price(uuid, numeric) TO authenticated;

-- 05:00, in the same quiet stretch as the other daily hygiene jobs.
SELECT cron.schedule('sync-competitor-prices-daily', '0 5 * * *',
  $cron$ SELECT public.invoke_edge_function('sync-competitor-prices', '{}'::jsonb, 'service'); $cron$)
WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-competitor-prices-daily');
