-- ===========================================================================
-- Invariants for the home-page merchandising engine.
--
-- Run against any environment after applying
-- 20260729160000_home_merchandising_engine.sql. Every row must report ok = t.
-- These are properties the shop window must hold regardless of how the weights
-- in store_settings are tuned or what the supplier feed pushes -- so a failure
-- here is a real defect, not a taste disagreement.
--
--   psql "$DATABASE_URL" -f supabase/tests/home_showcase_invariants.sql
-- ===========================================================================

SELECT public.refresh_home_showcase();

WITH checks AS (
  SELECT 'no product occupies two slots' AS invariant,
         (SELECT count(*) FROM (
            SELECT product_id FROM public.home_showcase
             GROUP BY product_id HAVING count(*) > 1) d) = 0 AS ok

  UNION ALL SELECT 'every showcased product is active',
    (SELECT count(*) FROM public.home_showcase h
       JOIN public.products p ON p.id = h.product_id
      WHERE NOT p.is_active) = 0

  UNION ALL SELECT 'every showcased product is residential',
    (SELECT count(*) FROM public.home_showcase h
       JOIN public.products p ON p.id = h.product_id
      WHERE p.audience IS DISTINCT FROM 'residential') = 0

  UNION ALL SELECT 'nothing above the residential price ceiling',
    (SELECT count(*) FROM public.home_showcase h
       JOIN public.products p ON p.id = h.product_id
      WHERE p.price > public.merch_setting('merch.max_price', 15000)) = 0

  UNION ALL SELECT 'nothing below the minimum price',
    (SELECT count(*) FROM public.home_showcase h
       JOIN public.products p ON p.id = h.product_id
      WHERE p.price < public.merch_setting('merch.min_price', 80)) = 0

  UNION ALL SELECT 'every showcased product has a real photograph',
    (SELECT count(*) FROM public.home_showcase h
       JOIN public.products p ON p.id = h.product_id
      WHERE public.merch_media_quality(p.images) < 50) = 0

  UNION ALL SELECT 'no warranty or datacentre product in the shop window',
    (SELECT count(*) FROM public.home_showcase h
       JOIN public.products p ON p.id = h.product_id
      WHERE p.category IN ('Support & Warranty', 'Servers & Data Centre')) = 0

  UNION ALL SELECT 'per-brand diversity cap holds',
    (SELECT count(*) FROM (
       SELECT h.slot, p.brand FROM public.home_showcase h
         JOIN public.products p ON p.id = h.product_id
        GROUP BY h.slot, p.brand
       HAVING count(*) > public.merch_setting('merch.max_per_brand', 2)) d) = 0

  UNION ALL SELECT 'per-category diversity cap holds',
    (SELECT count(*) FROM (
       SELECT h.slot, p.category FROM public.home_showcase h
         JOIN public.products p ON p.id = h.product_id
        GROUP BY h.slot, p.category
       HAVING count(*) > public.merch_setting('merch.max_per_category', 3)) d) = 0

  UNION ALL SELECT 'ranks are contiguous from 1 within each slot',
    (SELECT count(*) FROM (
       SELECT slot, count(*) AS n, max(rank) AS hi, min(rank) AS lo
         FROM public.home_showcase GROUP BY slot) d
      WHERE n <> hi OR lo <> 1) = 0

  UNION ALL SELECT 'every placement carries at least one reason',
    (SELECT count(*) FROM public.home_showcase
      WHERE jsonb_array_length(reasons) = 0) = 0

  UNION ALL SELECT 'every placement records its component scores',
    (SELECT count(*) FROM public.home_showcase
      WHERE components = '{}'::jsonb) = 0

  -- The AI Picks grid prefers explicitly AI-tagged products, then AI-adjacent
  -- consumer tech, then tops up with the best of the rest so it always fills.
  UNION ALL SELECT 'ai_picks places AI-tagged products before untagged ones',
    (SELECT coalesce(bool_and(monotone), true) FROM (
       SELECT p.is_ai_product <= lag(p.is_ai_product) OVER (ORDER BY h.rank) AS monotone
         FROM public.home_showcase h
         JOIN public.products p ON p.id = h.product_id
        WHERE h.slot = 'ai_picks') d
      WHERE monotone IS NOT NULL)

  -- A garbage value in store_settings must fall back to the default, not raise:
  -- a typo in the admin UI cannot be allowed to stop the cron.
  UNION ALL SELECT 'an unparseable setting falls back to its default',
    public.merch_setting('merch.definitely.not.a.key', 0.42) = 0.42

  UNION ALL SELECT 'scoring is bounded to 0-100',
    (SELECT bool_and(score BETWEEN 0 AND 100) FROM public.home_showcase)
)
SELECT invariant, ok FROM checks ORDER BY ok, invariant;
