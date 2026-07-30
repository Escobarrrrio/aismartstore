-- ===========================================================================
-- Business page: rank by expected profit, not by price
-- ===========================================================================
--
-- Procurement.tsx hardcoded `sort_by: 'price_desc'`. The business page therefore
-- opened with a R24 137 302 HPE Alletra storage array, out of stock, followed by
-- four more multi-million-rand arrays. Nobody has ever bought one of those from
-- a web listing, and nobody ever will -- that is a months-long engagement with a
-- sales team this business does not have.
--
-- WHAT REPLACED IT
-- ----------------
-- expected_value = margin_rand x close_rate x repeat_factor
--
--   margin_rand    price x margin% (all 2 403 business products carry real cost
--                  data, averaging 17%)
--   close_rate     0.12 / (1 + (price/2000)^1.15), then x1.6 in stock, x0.5 not
--   repeat_factor  1 + 6/(1 + price/1500)
--
-- A FIRST ATTEMPT THAT WAS WRONG, AND WHY
-- ---------------------------------------
-- The close rate started as price bands (0.10 under R2k ... 0.008 above R250k).
-- That failed: 17% of R24m is R4.1m, and even at 0.4% that is R16 413 expected
-- -- so "expected value" ranked the array first all over again and merely
-- reproduced price_desc with extra arithmetic. A step function cannot fall fast
-- enough to beat a linear margin.
--
-- The continuous decay does. Its exponent is deliberately above 1, so expected
-- value declines with deal size rather than tracking it, and the repeat factor
-- annualises: a consumable re-ordered quarterly is worth more over a year than
-- an array bought once a decade.
--
-- WHY IT IS NOT PSYCHOLOGICAL MANIPULATION
-- ----------------------------------------
-- The ordering optimises for what genuinely closes -- in-stock, procurement-
-- sized, real margin. Nothing here inflates a price, invents scarcity or hides
-- an out-of-stock state; `in_stock` still shows honestly on every card. Ranking
-- what a buyer can actually receive this week is aligned with the buyer, not
-- against them, which is also why it makes more money.
--
-- Result at the top of the page now: Intel Xeon Silver CPUs, an Aruba 6100
-- switch, enterprise SSDs -- R18k to R28k, every one in stock.
--
-- NOTE ON MARGIN: every product currently carries the same 17% flat markup, so
-- margin% is not discriminating between items today. Stock and deal size are
-- doing the work. The moment real per-line margins arrive from Axiz, this
-- engine starts using them with no change.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.biz_close_rate(p_price numeric, p_in_stock boolean)
RETURNS numeric LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
  SELECT greatest(0.0000001, (
    0.12 / (1 + power(greatest(coalesce(p_price,0),1) / 2000.0, 1.15))
  ) * CASE WHEN coalesce(p_in_stock,false) THEN 1.6 ELSE 0.5 END)::numeric;
$fn$;
COMMENT ON FUNCTION public.biz_close_rate(numeric, boolean) IS
  'Probability a B2B web listing converts. Decays continuously with deal size; stock is a 3.2x swing because lead time is what kills B2B deals.';

CREATE OR REPLACE FUNCTION public.biz_repeat_factor(p_price numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
  SELECT (1 + 6.0 / (1 + greatest(coalesce(p_price,0),1) / 1500.0))::numeric;
$fn$;
COMMENT ON FUNCTION public.biz_repeat_factor(numeric) IS
  'Annualisation: consumables re-order, capital equipment does not.';

CREATE OR REPLACE FUNCTION public.score_business_product(
  p_price numeric, p_margin_pct numeric, p_in_stock boolean,
  p_name text, p_brand text, p_category text
) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $fn$
DECLARE
  v_pct    numeric := coalesce(nullif(p_margin_pct,0), 17);
  v_margin numeric := coalesce(p_price,0) * v_pct / 100.0;
  v_close  numeric := public.biz_close_rate(p_price, p_in_stock);
  v_rep    numeric := public.biz_repeat_factor(p_price);
  v_ev     numeric := round(v_margin * v_close * v_rep, 2);
  v_r      text[]  := ARRAY[]::text[];
BEGIN
  IF v_pct >= 20 THEN v_r := v_r || format('Strong %s%% margin', round(v_pct,1))::text;
  ELSIF v_pct < 10 THEN v_r := v_r || format('Thin %s%% margin', round(v_pct,1))::text; END IF;

  IF coalesce(p_in_stock,false) THEN v_r := v_r || 'In stock - no lead-time objection'::text;
  ELSE v_r := v_r || 'Backorder - lead time is the deal killer in B2B'::text; END IF;

  IF p_price < 5000 THEN v_r := v_r || 'Closes without a procurement process'::text;
  ELSIF p_price >= 500000 THEN v_r := v_r || 'Tender-scale: rarely closes from a web listing'::text; END IF;

  IF v_rep >= 4 THEN v_r := v_r || 'Re-order line - earns repeatedly, not once'::text; END IF;

  RETURN jsonb_build_object(
    'expected_value', v_ev, 'margin_rand', round(v_margin,2), 'margin_pct', round(v_pct,1),
    'close_rate', round(v_close,6), 'repeat_factor', round(v_rep,2), 'reasons', to_jsonb(v_r));
END $fn$;
COMMENT ON FUNCTION public.score_business_product(numeric, numeric, boolean, text, text, text) IS
  'Expected annual gross profit from listing this product to a business buyer, with the reasoning behind it.';

CREATE OR REPLACE FUNCTION public.get_business_picks(p_limit integer DEFAULT 8)
RETURNS TABLE(
  id uuid, name text, description text, price numeric, category text, brand text,
  sku text, images text[], in_stock boolean, stock_quantity integer,
  is_ai_product boolean, created_at timestamptz,
  expected_value numeric, reasons jsonb
) LANGUAGE sql STABLE
SET search_path = public AS $fn$
  WITH scored AS (
    SELECT p.*, public.score_business_product(
             p.price, pc.margin_percentage, p.in_stock, p.name, p.brand, p.category) AS j,
           row_number() OVER (
             PARTITION BY p.brand
             ORDER BY (public.score_business_product(
               p.price, pc.margin_percentage, p.in_stock, p.name, p.brand, p.category)->>'expected_value')::numeric DESC
           ) AS brand_rank
      FROM public.products p
      JOIN public.product_costs pc ON pc.product_id = p.id
     WHERE p.is_active
       AND p.audience = 'business'
       AND p.price > 0
       AND p.images IS NOT NULL AND p.images[1] IS NOT NULL
       AND p.images[1] NOT ILIKE '%placeholder%'
  )
  SELECT id, name, description, price, category, brand, sku, images, in_stock,
         stock_quantity, is_ai_product, created_at,
         (j->>'expected_value')::numeric, j->'reasons'
    FROM scored
   -- Max 3 per brand: 831 of the business lines are HPE, and an all-HPE page
   -- reads as a distributor dump rather than a curated offer.
   WHERE brand_rank <= 3
   ORDER BY (j->>'expected_value')::numeric DESC
   LIMIT greatest(1, least(coalesce(p_limit, 8), 48));
$fn$;

GRANT EXECUTE ON FUNCTION public.biz_close_rate(numeric, boolean) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.biz_repeat_factor(numeric) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.score_business_product(numeric, numeric, boolean, text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_business_picks(integer) TO anon, authenticated, service_role;
