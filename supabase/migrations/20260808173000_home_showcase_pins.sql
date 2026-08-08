-- The "pin to rank 1" UI in MerchandisingModule.tsx (`home_showcase_pins`,
-- `set_home_showcase_pin`, `clear_home_showcase_pin`) shipped in frontend
-- code (merged from a Lovable session that worked against its own,
-- since-migrated-away-from database) with no matching migration in this
-- repo. The table and both RPCs it calls have never existed on this
-- database -- the feature has been silently broken in production since it
-- first went live. This migration is the missing half.
--
-- get_home_showcase() and refresh_home_showcase() (20260729160000) are
-- untouched in their read/rebuild behaviour except for one addition: each
-- pin is now re-applied at the end of every rebuild, scheduled or manual,
-- so a pin survives the `refresh-home-showcase` cron job instead of being
-- silently wiped by the next run -- otherwise "pin" would only mean "until
-- the next scheduled rebuild", which is not what the word promises.

CREATE TABLE IF NOT EXISTS public.home_showcase_pins (
  slot text PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  pinned_at timestamptz NOT NULL DEFAULT now(),
  pinned_by uuid REFERENCES auth.users(id)
);

ALTER TABLE public.home_showcase_pins ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies: only the SECURITY DEFINER functions below
-- touch this table, same posture as page_views and the rest of this
-- migration set.

-- Shared by set_home_showcase_pin() and refresh_home_showcase(): forces
-- whatever product is pinned for a slot to rank 1, shifts the rest down,
-- and trims back to the slot's target size. A no-op if nothing is pinned.
CREATE OR REPLACE FUNCTION public.merch_apply_pin(p_slot text, p_target int DEFAULT 8)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_product_id uuid;
BEGIN
  SELECT product_id INTO v_product_id FROM public.home_showcase_pins WHERE slot = p_slot;
  IF v_product_id IS NULL THEN
    RETURN;
  END IF;

  -- A pin to a product that has since been deactivated should lapse
  -- quietly rather than wedge a scheduled rebuild that nobody is watching.
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = v_product_id AND is_active) THEN
    DELETE FROM public.home_showcase_pins WHERE slot = p_slot;
    RETURN;
  END IF;

  DELETE FROM public.home_showcase WHERE slot = p_slot AND product_id = v_product_id;
  UPDATE public.home_showcase SET rank = rank + 1 WHERE slot = p_slot;

  INSERT INTO public.home_showcase (slot, rank, product_id, score, components, reasons)
  SELECT p_slot, 1, p.id,
         coalesce((SELECT c.score FROM public.home_showcase_candidates c WHERE c.id = p.id), 0),
         '{}'::jsonb,
         '["Pinned by admin"]'::jsonb
    FROM public.products p WHERE p.id = v_product_id;

  DELETE FROM public.home_showcase WHERE slot = p_slot AND rank > greatest(1, p_target);
END $$;

REVOKE ALL ON FUNCTION public.merch_apply_pin(text, int) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_home_showcase_pin(p_slot text, p_product_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'set_home_showcase_pin: admin role required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_product_id AND is_active) THEN
    RAISE EXCEPTION 'set_home_showcase_pin: product is not active';
  END IF;

  INSERT INTO public.home_showcase_pins (slot, product_id, pinned_by, pinned_at)
  VALUES (p_slot, p_product_id, auth.uid(), now())
  ON CONFLICT (slot) DO UPDATE
    SET product_id = excluded.product_id, pinned_by = excluded.pinned_by, pinned_at = now();

  PERFORM public.merch_apply_pin(p_slot);
END $$;

REVOKE ALL ON FUNCTION public.set_home_showcase_pin(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_home_showcase_pin(text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.clear_home_showcase_pin(p_slot text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'clear_home_showcase_pin: admin role required';
  END IF;

  DELETE FROM public.home_showcase_pins WHERE slot = p_slot;
  PERFORM public.refresh_home_showcase();
END $$;

REVOKE ALL ON FUNCTION public.clear_home_showcase_pin(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clear_home_showcase_pin(text) TO authenticated;

-- refresh_home_showcase(): identical to the version in
-- 20260729160000_home_merchandising_engine.sql, with one addition --
-- `PERFORM public.merch_apply_pin(v_slot);` at the end of each slot's
-- ranking loop, so a pin is re-applied after every rebuild instead of only
-- surviving until the next one.
CREATE OR REPLACE FUNCTION public.refresh_home_showcase()
RETURNS TABLE(slot text, filled integer)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_max_brand int := greatest(1, public.merch_setting('merch.max_per_brand', 2)::int);
  v_max_cat   int := greatest(1, public.merch_setting('merch.max_per_category', 3)::int);
  v_slot      text;
  v_target    int;
  v_rank      int;
  v_cand      int;
  v_brands    jsonb;
  v_cats      jsonb;
  bkey        text;
  ckey        text;
  r           record;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'refresh_home_showcase: admin role required';
  END IF;

  CREATE TEMP TABLE _merch_candidates ON COMMIT DROP AS
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
       AND p.audience = 'residential'
       AND public.merch_is_home_eligible(p.category, p.name, p.price, p.images, p.is_ai_product)
  )
  SELECT e.id,
         coalesce(nullif(public.merch_norm(e.brand), ''), '(none)')    AS brand_key,
         coalesce(nullif(e.category, ''), '(none)')                    AS category_key,
         e.in_stock,
         CASE
           WHEN e.is_ai_product THEN 3
           WHEN e.category IN ('Smart Home', 'Wearables', 'Health & Wellness', 'GPUs & AI Accelerators') THEN 2
           WHEN public.merch_norm(e.name) ~ '\y(ai|a\.i\.|npu|neural|copilot|smart|voice assistant|machine learning)\y' THEN 2
           ELSE 1
         END AS ai_tier,
         j.payload,
         (j.payload->>'score')::numeric AS score
    FROM eligible e
    CROSS JOIN LATERAL (
      SELECT public.score_home_product(
        e.category, e.name, e.brand, e.price, e.in_stock,
        e.stock_quantity, e.images, e.is_ai_product, e.signal
      ) AS payload
    ) j;

  SELECT count(*) INTO v_cand FROM _merch_candidates;

  IF v_cand = 0 THEN
    RAISE WARNING 'refresh_home_showcase: no eligible candidates, keeping the previous showcase';
    RETURN QUERY SELECT h.slot, count(*)::int FROM public.home_showcase h GROUP BY h.slot;
    RETURN;
  END IF;

  DELETE FROM public.home_showcase;

  FOR v_slot, v_target IN
    SELECT * FROM (VALUES ('ai_picks', 8), ('featured', 8)) AS s(a, b)
  LOOP
    v_rank   := 0;
    v_brands := '{}'::jsonb;
    v_cats   := '{}'::jsonb;

    FOR r IN
      SELECT c.*
        FROM _merch_candidates c
       WHERE NOT EXISTS (
               SELECT 1 FROM public.home_showcase h WHERE h.product_id = c.id
             )
       ORDER BY
         CASE WHEN v_slot = 'ai_picks' THEN c.ai_tier ELSE 0 END DESC,
         c.score DESC,
         c.in_stock DESC,
         c.id
    LOOP
      EXIT WHEN v_rank >= v_target;

      bkey := r.brand_key;
      ckey := r.category_key;
      CONTINUE WHEN coalesce((v_brands->>bkey)::int, 0) >= v_max_brand;
      CONTINUE WHEN coalesce((v_cats->>ckey)::int, 0)   >= v_max_cat;

      v_rank := v_rank + 1;
      INSERT INTO public.home_showcase
        (slot, rank, product_id, score, components, reasons)
      VALUES
        (v_slot, v_rank, r.id, r.score,
         coalesce(r.payload->'components', '{}'::jsonb),
         coalesce(r.payload->'reasons',    '[]'::jsonb));

      v_brands := v_brands || jsonb_build_object(bkey, coalesce((v_brands->>bkey)::int, 0) + 1);
      v_cats   := v_cats   || jsonb_build_object(ckey, coalesce((v_cats->>ckey)::int, 0) + 1);
    END LOOP;

    PERFORM public.merch_apply_pin(v_slot, v_target);
  END LOOP;

  RETURN QUERY SELECT h.slot, count(*)::int FROM public.home_showcase h GROUP BY h.slot;
END $function$;
