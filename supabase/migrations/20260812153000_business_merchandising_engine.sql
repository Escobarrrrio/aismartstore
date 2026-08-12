-- ===========================================================================
-- Business/procurement merchandising engine
-- ===========================================================================
--
-- WHAT WAS WRONG
-- --------------
-- Procurement.tsx picked its enterprise-catalogue row with
-- `sort_by: "price_desc"` -- literally "most expensive first". That was never
-- asked for; it read as "flaunt the R23m HPE array", not "here is what
-- businesses actually buy from us". Price is not demand.
--
-- WHAT THIS IS
-- ------------
-- The same shape as the residential home_merchandising_engine
-- (20260729160000), reusing every factor that isn't audience-specific
-- (merch_name_quality, merch_availability, merch_media_quality,
-- merch_signal_score -- title readability, buy-today confidence, photo
-- quality and real-order/wishlist signal don't change meaning by audience)
-- and adding business-specific replacements for the three that do
-- (demand tier, brand trust, price fit).
--
-- Same honesty this has to carry over from the original: this is a
-- deterministic, reasoned prior -- not a market-research report, and it says
-- so on the label. `merch_signal_score` is real behavioural data (paid
-- order_items, wishlist saves) and is weighted *higher* here than on the
-- residential engine (0.10 vs 0.05, see the seeded weights below) precisely
-- because "what's actually moving" was the explicit ask. As real business
-- orders accumulate, the signal term rises and starts overriding the priors
-- on its own, without a deploy -- launch on judgement, converge on evidence,
-- same lifecycle as the residential engine already documents.
--
-- Price is intentionally de-weighted to near-nothing (0.05, same numeric
-- weight residential gives it the least of anything) and its own curve
-- (merch_business_price_fit) does not reward being expensive -- it peaks in
-- the typical single-server/workstation/networking-gear purchase band and
-- *tapers* above ~R100k rather than climbing. Multi-million-rand line items
-- can still place if demand/brand/signal earn it, but price itself is never
-- the reason something leads.
--
-- To revert: SELECT cron.unschedule('refresh-business-showcase');
--            DROP TABLE public.business_showcase; DROP VIEW ...; DROP FUNCTION ...
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. DEMAND -- what South African business/government IT procurement
--    actually buys, not what a household shops for (merch_demand_tier's
--    priors are the inverse of this on purpose: "Servers & Data Centre"
--    scores 4 there and is hard-excluded -- it is the #1 business category).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.merch_business_demand_tier(
  p_category text,
  p_name     text,
  p_is_ai    boolean DEFAULT false
) RETURNS numeric LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  n    text    := public.merch_norm(p_name);
  cat  text    := coalesce(p_category, '');
  base numeric;
BEGIN
  base := CASE cat
    WHEN 'Servers & Data Centre'   THEN  96   -- the category a business catalogue exists for
    WHEN 'Networking'              THEN  92   -- every office/site needs this, recurring refresh cycle
    WHEN 'Laptops'                 THEN  90   -- fleet purchases: the single most common real B2B buy
    WHEN 'Storage'                 THEN  88   -- NAS/SAN/backup, a standing IT-budget line item
    WHEN 'GPUs & AI Accelerators'  THEN  85   -- core to this store's AI-infrastructure positioning
    WHEN 'Desktops & Workstations' THEN  84
    WHEN 'Software & Licensing'    THEN  80   -- recurring, budgeted, not impulse -- but real spend
    WHEN 'Monitors & Displays'     THEN  74
    WHEN 'Support & Warranty'      THEN  70   -- unlike residential: businesses genuinely buy SLAs
    WHEN 'Memory'                  THEN  64   -- fleet/server upgrade part
    WHEN 'Peripherals'             THEN  60   -- office fit-out, real but not a lead item
    WHEN 'Printer Consumables'     THEN  40
    WHEN 'Accessories (General)'   THEN  36
    WHEN 'Cables & Connectivity'   THEN  22
    WHEN 'Smart Home'              THEN  12   -- real lines in this catalogue, not a procurement lead
    WHEN 'Wearables'               THEN  10
    WHEN 'Health & Wellness'       THEN  10
    ELSE 45                                   -- unknown category: neutral, never punished
  END;

  -- Server/rack/enterprise-storage vocabulary is exactly what residential
  -- floors to near-zero (see merch_demand_tier) -- here it's a lift, because
  -- it is unambiguous evidence of exactly the buyer this catalogue serves.
  IF n ~ '\y(server|rack|rail|blade|chassis|proliant|synergy|nimble|alletra|apollo|dl[0-9]{3}|ml[0-9]{2,3}|xl[0-9]{2,3}[a-z]?|bl[0-9]{3}|sy[0-9]{3}|gen[0-9]{1,2}\+?)\y' THEN
    base := greatest(base, 92);
  ELSIF n ~ '\y(switch|router|access point|firewall|sd-?wan|load balancer)\y' THEN
    base := greatest(base, 88);
  ELSIF n ~ '\y(nas|san|raid|backup appliance)\y' THEN
    base := greatest(base, 86);
  ELSIF n ~ '\y(laptop|notebook|ultrabook)\y'
     AND n !~ '\y(bag|case|sleeve|backpack|charger|adapter|adaptor)\y' THEN
    base := greatest(base, 90);
  END IF;

  -- Bare cabling/power leads are a real line item but never a lead card,
  -- same reasoning as the residential floor (bulk cabling, section 1 there).
  IF n ~ '\y(power cord|jumper cord|patch cord|patch cable|patch panel|c13|c14|c19|c20|cable tie|cable manager)\y' THEN
    base := least(base, 20);
  END IF;

  IF coalesce(p_is_ai, false) THEN
    base := least(100, base + 5);
  END IF;

  RETURN greatest(0, least(100, base));
END $$;
COMMENT ON FUNCTION public.merch_business_demand_tier(text, text, boolean) IS
  'Business/procurement demand prior 0-100 -- the mirror image of merch_demand_tier: servers, networking and storage lead; smart-home/wellness lines are demoted.';


-- ---------------------------------------------------------------------------
-- 2. BRAND -- procurement trust, the mirror of consumer recognition
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.merch_business_brand_trust(p_brand text)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE b text := public.merch_norm(p_brand);
BEGIN
  IF b = '' THEN RETURN 40; END IF;

  -- Tier 1: the brands a procurement officer specs into a tender by name.
  IF b ~ '^(hpe|hewlett packard enterprise|cisco|juniper|aruba|fortinet|vmware|nutanix|netapp|supermicro|lenovo dcg|ibm|oracle|citrix|barracuda|sophos|dell|dell e|microsoft|veeam|ubiquiti|mikrotik|synology|qnap|d-?link|extreme|axis)( .*)?$' THEN
    RETURN 100;
  END IF;

  -- Tier 2: credible, mainstream business-IT brands.
  IF b ~ '^(hp|hpic|hp inc|lenovo|asus|acer|logitech|jabra|kingston|crucial|seagate|western digital|wd|intel|amd|nvidia|epson|brother|targus|kensington|jvc|hikvision|imou)( .*)?$' THEN
    RETURN 78;
  END IF;

  -- Tier 3: real, deliberately-stocked lines, but not procurement-relevant --
  -- the same smart-home/wellness set merch_brand_trust rates highly for a
  -- household shopper, rated low here for the opposite reason.
  IF b ~ '^(switchbot|govee|lifx|nanoleaf|oura|withings|roborock|ecovacs|tuya|eufy|tapo|amazfit)( .*)?$' THEN
    RETURN 20;
  END IF;

  RETURN 50;
END $$;
COMMENT ON FUNCTION public.merch_business_brand_trust(text) IS
  'Procurement brand trust 0-100 -- the mirror of merch_brand_trust: enterprise-line brands score highest, consumer-novelty brands score low.';


-- ---------------------------------------------------------------------------
-- 3. PRICE -- deliberately NOT "more expensive is better". Peaks at a typical
--    single considered-purchase band, tapers above it. This factor carries
--    the lowest weight of the whole score (see seeded weights below) on
--    purpose: price must never be the reason something leads.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.merch_business_price_fit(p_price numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN p_price IS NULL OR p_price <= 0 THEN 0
    WHEN p_price <      200 THEN  45   -- too trivial to headline a B2B slot
    WHEN p_price <     5000 THEN  75
    WHEN p_price <   100000 THEN 100   -- typical single server/workstation/networking purchase
    WHEN p_price <  1000000 THEN  80   -- still a plausible line item, not "the point"
    ELSE                           55  -- real, but rare -- never boosted for being extreme
  END::numeric;
$$;
COMMENT ON FUNCTION public.merch_business_price_fit(numeric) IS
  'Business price-band fit 0-100. Peaks at a typical single-purchase band (R5k-R100k) and tapers above it -- deliberately does not reward being the most expensive item.';


-- ---------------------------------------------------------------------------
-- 4. Hard eligibility -- unlike residential, no price ceiling (a business
--    catalogue that cannot surface a genuine R2m server purchase is broken),
--    but the same floor: a real title and a real photo.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.merch_is_business_eligible(
  p_category text, p_name text, p_price numeric, p_images text[], p_is_ai boolean DEFAULT false
) RETURNS boolean LANGUAGE plpgsql STABLE
SET search_path = public AS $$
DECLARE
  v_min_price  numeric := public.merch_setting('merch.business.min_price',  200);
  v_min_demand numeric := public.merch_setting('merch.business.min_demand', 30);
BEGIN
  IF coalesce(btrim(p_name), '') = '' THEN RETURN false; END IF;
  IF p_price IS NULL OR p_price < v_min_price THEN RETURN false; END IF;
  IF public.merch_media_quality(p_images) < 50 THEN RETURN false; END IF;
  RETURN public.merch_business_demand_tier(p_category, p_name, p_is_ai) >= v_min_demand;
END $$;
COMMENT ON FUNCTION public.merch_is_business_eligible(text, text, numeric, text[], boolean) IS
  'Hard gate for business-showcase candidacy: real title, real photo, minimum procurement demand. No price ceiling -- unlike residential, high-ticket items are exactly the point.';


-- ---------------------------------------------------------------------------
-- 5. The composite score
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.score_business_product(
  p_category       text,
  p_name           text,
  p_brand          text,
  p_price          numeric,
  p_in_stock       boolean,
  p_stock_quantity integer,
  p_images         text[],
  p_is_ai          boolean DEFAULT false,
  p_signal         numeric DEFAULT 0
) RETURNS jsonb LANGUAGE plpgsql STABLE
SET search_path = public AS $$
DECLARE
  c_demand  numeric := public.merch_business_demand_tier(p_category, p_name, p_is_ai);
  c_brand   numeric := public.merch_business_brand_trust(p_brand);
  c_price   numeric := public.merch_business_price_fit(p_price);
  c_name    numeric := public.merch_name_quality(p_name);
  c_avail   numeric := public.merch_availability(p_in_stock, p_stock_quantity);
  c_media   numeric := public.merch_media_quality(p_images);
  c_signal  numeric := greatest(0, least(100, coalesce(p_signal, 0)));
  w_demand  numeric := public.merch_setting('merch.business.weight.demand',       0.35);
  w_brand   numeric := public.merch_setting('merch.business.weight.brand',        0.15);
  w_price   numeric := public.merch_setting('merch.business.weight.price',        0.05);
  w_name    numeric := public.merch_setting('merch.business.weight.name',         0.10);
  w_avail   numeric := public.merch_setting('merch.business.weight.availability', 0.20);
  w_media   numeric := public.merch_setting('merch.business.weight.media',        0.05);
  w_signal  numeric := public.merch_setting('merch.business.weight.signal',       0.10);
  w_total   numeric;
  v_score   numeric;
  v_reasons text[]  := ARRAY[]::text[];
BEGIN
  w_total := w_demand + w_brand + w_price + w_name + w_avail + w_media + w_signal;
  IF w_total IS NULL OR w_total <= 0 THEN
    w_demand := 0.35; w_brand := 0.15; w_price := 0.05; w_name := 0.10;
    w_avail  := 0.20; w_media := 0.05; w_signal := 0.10; w_total := 1.00;
  END IF;

  v_score := (
      c_demand * w_demand + c_brand  * w_brand + c_price * w_price
    + c_name   * w_name   + c_avail  * w_avail + c_media * w_media
    + c_signal * w_signal
  ) / w_total;

  IF c_demand >= 85 THEN
    v_reasons := v_reasons || 'Core infrastructure category for business/government buyers'::text;
  ELSIF c_demand < 40 THEN
    v_reasons := v_reasons || 'Niche for procurement -- only placed when nothing better fits'::text;
  END IF;

  IF c_brand >= 100 THEN
    v_reasons := v_reasons || 'Brand procurement teams already spec by name'::text;
  END IF;

  IF c_avail >= 88 THEN
    v_reasons := v_reasons || 'In stock, can ship on the next dispatch'::text;
  ELSIF c_avail <= 30 THEN
    v_reasons := v_reasons || 'Backorder -- shown for relevance, dispatch date is honest'::text;
  END IF;

  IF c_signal > 0 THEN
    v_reasons := v_reasons || 'Real customers have already bought or saved this'::text;
  END IF;

  IF coalesce(p_is_ai, false) THEN
    v_reasons := v_reasons || 'Tagged as AI infrastructure'::text;
  END IF;

  RETURN jsonb_build_object(
    'score', round(v_score, 2),
    'components', jsonb_build_object(
      'demand', c_demand, 'brand', c_brand, 'price', c_price, 'name', c_name,
      'availability', c_avail, 'media', c_media, 'signal', round(c_signal, 2)
    ),
    'reasons', to_jsonb(v_reasons)
  );
END $$;
COMMENT ON FUNCTION public.score_business_product(text, text, text, numeric, boolean, integer, text[], boolean, numeric) IS
  'Composite 0-100 business-showcase merchandising score. Price carries the lowest weight of any factor by design -- see file header.';


-- ---------------------------------------------------------------------------
-- 6. The curated showcase
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.business_showcase (
  slot         text        NOT NULL,
  rank         integer     NOT NULL,
  product_id   uuid        NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  score        numeric(6,2) NOT NULL,
  components   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  reasons      jsonb       NOT NULL DEFAULT '[]'::jsonb,
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (slot, rank),
  CONSTRAINT business_showcase_rank_positive CHECK (rank >= 1 AND rank <= 24),
  CONSTRAINT business_showcase_slot_known CHECK (slot IN ('enterprise_picks'))
);

CREATE UNIQUE INDEX IF NOT EXISTS business_showcase_product_unique
  ON public.business_showcase (product_id);

COMMENT ON TABLE public.business_showcase IS
  'Curated, scored product slots for the Procurement page. Rebuilt by refresh_business_showcase(); read by get_business_showcase().';

ALTER TABLE public.business_showcase ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Business showcase is public" ON public.business_showcase;
CREATE POLICY "Business showcase is public"
  ON public.business_showcase FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins can manage the business showcase" ON public.business_showcase;
CREATE POLICY "Admins can manage the business showcase"
  ON public.business_showcase FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

GRANT SELECT ON public.business_showcase TO anon, authenticated;
GRANT ALL    ON public.business_showcase TO service_role;

-- Same reasoning as the residential weights: these are merchandising dials
-- shoppers' own page load reads (via score_business_product), not secrets.
-- The "Anyone can view public store settings" policy already covers anything
-- matching 'merch.%', which includes 'merch.business.%' -- no new policy needed.
INSERT INTO public.store_settings (key, value)
VALUES
  ('merch.business.weight.demand',       '0.35'),
  ('merch.business.weight.brand',        '0.15'),
  ('merch.business.weight.price',        '0.05'),
  ('merch.business.weight.name',         '0.10'),
  ('merch.business.weight.availability', '0.20'),
  ('merch.business.weight.media',        '0.05'),
  ('merch.business.weight.signal',       '0.10'),
  ('merch.business.min_price',           '200'),
  ('merch.business.min_demand',          '30'),
  ('merch.business.max_per_brand',       '3'),
  ('merch.business.max_per_category',    '4')
ON CONFLICT (key) DO NOTHING;


-- ---------------------------------------------------------------------------
-- 7. The refresh
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_business_showcase()
RETURNS TABLE(slot text, filled integer)
LANGUAGE plpgsql
SET search_path = public AS $$
DECLARE
  v_max_brand int := greatest(1, public.merch_setting('merch.business.max_per_brand', 3)::int);
  v_max_cat   int := greatest(1, public.merch_setting('merch.business.max_per_category', 4)::int);
  v_target    int := 24;
  v_rank      int := 0;
  v_cand      int;
  v_brands    jsonb := '{}'::jsonb;
  v_cats      jsonb := '{}'::jsonb;
  bkey        text;
  ckey        text;
  r           record;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'refresh_business_showcase: admin role required';
  END IF;

  CREATE TEMP TABLE _biz_merch_candidates ON COMMIT DROP AS
  WITH raw_signals AS (
    SELECT oi.product_id, sum(oi.quantity)::numeric AS units, 0::numeric AS saves
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
     WHERE o.payment_status = 'paid'
       AND o.created_at > now() - interval '180 days'
     GROUP BY oi.product_id
    UNION ALL
    SELECT w.product_id, 0::numeric, count(*)::numeric
      FROM public.wishlists w
     WHERE w.created_at > now() - interval '180 days'
     GROUP BY w.product_id
  ),
  signals AS (
    SELECT product_id, sum(units) AS units, sum(saves) AS saves
      FROM raw_signals GROUP BY product_id
  ),
  eligible AS (
    SELECT p.id, p.name, p.brand, p.category, p.price, p.in_stock,
           p.stock_quantity, p.images, p.is_ai_product,
           public.merch_signal_score(coalesce(s.units, 0), coalesce(s.saves, 0)) AS signal
      FROM public.products p
      LEFT JOIN signals s ON s.product_id = p.id
     WHERE p.is_active
       AND p.audience = 'business'
       AND public.merch_is_business_eligible(p.category, p.name, p.price, p.images, p.is_ai_product)
  )
  SELECT e.id,
         coalesce(nullif(public.merch_norm(e.brand), ''), '(none)') AS brand_key,
         coalesce(nullif(e.category, ''), '(none)')                 AS category_key,
         e.in_stock,
         j.payload,
         (j.payload->>'score')::numeric AS score
    FROM eligible e
    CROSS JOIN LATERAL (
      SELECT public.score_business_product(
        e.category, e.name, e.brand, e.price, e.in_stock,
        e.stock_quantity, e.images, e.is_ai_product, e.signal
      ) AS payload
    ) j;

  SELECT count(*) INTO v_cand FROM _biz_merch_candidates;

  IF v_cand = 0 THEN
    RAISE WARNING 'refresh_business_showcase: no eligible candidates, keeping the previous showcase';
    RETURN QUERY SELECT h.slot, count(*)::int FROM public.business_showcase h GROUP BY h.slot;
    RETURN;
  END IF;

  DELETE FROM public.business_showcase;

  FOR r IN
    SELECT c.* FROM _biz_merch_candidates c
     ORDER BY c.score DESC, c.in_stock DESC, c.id
  LOOP
    EXIT WHEN v_rank >= v_target;

    bkey := r.brand_key;
    ckey := r.category_key;
    CONTINUE WHEN coalesce((v_brands->>bkey)::int, 0) >= v_max_brand;
    CONTINUE WHEN coalesce((v_cats->>ckey)::int, 0)   >= v_max_cat;

    v_rank := v_rank + 1;
    INSERT INTO public.business_showcase
      (slot, rank, product_id, score, components, reasons)
    VALUES
      ('enterprise_picks', v_rank, r.id, r.score,
       coalesce(r.payload->'components', '{}'::jsonb),
       coalesce(r.payload->'reasons',    '[]'::jsonb));

    v_brands := v_brands || jsonb_build_object(bkey, coalesce((v_brands->>bkey)::int, 0) + 1);
    v_cats   := v_cats   || jsonb_build_object(ckey, coalesce((v_cats->>ckey)::int, 0) + 1);
  END LOOP;

  RETURN QUERY SELECT h.slot, count(*)::int FROM public.business_showcase h GROUP BY h.slot;
END $$;
COMMENT ON FUNCTION public.refresh_business_showcase() IS
  'Rebuilds business_showcase: scores every eligible business-audience product, then greedily fills it subject to per-brand and per-category diversity caps. Never blanks the showcase.';

REVOKE ALL ON FUNCTION public.refresh_business_showcase() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_business_showcase() TO authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 8. The read path
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_business_showcase(
  p_limit integer DEFAULT 24
) RETURNS TABLE(
  id             uuid,
  name           text,
  description    text,
  price          numeric,
  category       text,
  brand          text,
  sku            text,
  images         text[],
  in_stock       boolean,
  stock_quantity integer,
  is_ai_product  boolean,
  specifications jsonb,
  created_at     timestamptz,
  score          numeric,
  reasons        jsonb,
  rank           integer
) LANGUAGE sql STABLE
SET search_path = public AS $$
  SELECT p.id, p.name, p.description, p.price, p.category, p.brand, p.sku,
         p.images, p.in_stock, p.stock_quantity, p.is_ai_product,
         p.specifications, p.created_at,
         h.score, h.reasons, h.rank
    FROM public.business_showcase h
    JOIN public.products p ON p.id = h.product_id
   WHERE h.slot = 'enterprise_picks'
     AND p.is_active
   ORDER BY h.rank
   LIMIT greatest(1, least(coalesce(p_limit, 24), 24));
$$;
COMMENT ON FUNCTION public.get_business_showcase(integer) IS
  'Curated Procurement-page products, newest refresh, active only. Ordered by the business merchandising score -- NOT by price.';

GRANT EXECUTE ON FUNCTION public.get_business_showcase(integer) TO anon, authenticated, service_role;


-- Dry-run view, same purpose as home_showcase_candidates: inspect and argue
-- with the ranking before it reaches the page.
CREATE OR REPLACE VIEW public.business_showcase_candidates AS
SELECT p.id,
       p.name,
       p.brand,
       p.category,
       p.price,
       p.in_stock,
       p.is_ai_product,
       (j.payload->>'score')::numeric AS score,
       j.payload->'components'        AS components,
       j.payload->'reasons'           AS reasons
  FROM public.products p
  CROSS JOIN LATERAL (
    SELECT public.score_business_product(
      p.category, p.name, p.brand, p.price, p.in_stock,
      p.stock_quantity, p.images, p.is_ai_product, 0
    ) AS payload
  ) j
 WHERE p.is_active
   AND p.audience = 'business'
   AND public.merch_is_business_eligible(p.category, p.name, p.price, p.images, p.is_ai_product);

COMMENT ON VIEW public.business_showcase_candidates IS
  'Every business-showcase-eligible product with its merchandising score and reasoning. Excludes the behavioural signal term (use refresh_business_showcase for the live ranking).';

GRANT SELECT ON public.business_showcase_candidates TO authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 9. Keep it fresh -- offset from refresh-home-showcase (:43) so the two
--    never contend with each other or with axiz-sync (*/15).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-business-showcase') THEN
    PERFORM cron.schedule(
      'refresh-business-showcase', '47 */3 * * *',
      $cron$ SELECT public.refresh_business_showcase(); $cron$
    );
  END IF;
END $$;

-- Populate immediately so the first page load after deploy is already curated.
SELECT public.refresh_business_showcase();
