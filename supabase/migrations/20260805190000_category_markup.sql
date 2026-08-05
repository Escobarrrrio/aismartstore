-- Margin by category, instead of one number for the whole catalogue.
--
-- Every product in this store is priced `cost x 1.17`, from R200 cables to
-- R35,000 robot vacuums, because `store_settings.axiz_markup_pct` is a single
-- value. That is not a pricing strategy, it is the absence of one, and it is
-- wrong in both directions at once:
--
--   * 17% on a R200 cable is R34. A card fee and a courier bag eat it. That
--     product is sold at a loss the moment anything goes wrong with it.
--   * 17% on a R35,000 workstation is R5,950 on a line where the market pays
--     single digits, so the store is simply not competitive on its own
--     highest-value stock.
--
-- Every serious retailer sets margin by department for exactly this reason.
--
-- Resolution is exact and case-insensitive, never fuzzy: a rule that silently
-- catches a category nobody intended is a pricing error applied across a whole
-- department, and "why is everything in Laptops at 40%?" is a much harder
-- question to answer later than "why did my rule not apply?".

CREATE TABLE IF NOT EXISTS public.category_markup (
  -- NULL is the fallback rule that applies to everything without its own.
  -- A partial unique index enforces there being only one of them, because two
  -- fallbacks would make pricing depend on row order.
  category   text,
  percent    numeric NOT NULL CHECK (percent >= 0 AND percent <= 500),
  note       text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS category_markup_category_key
  ON public.category_markup (lower(category)) WHERE category IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS category_markup_default_key
  ON public.category_markup ((true)) WHERE category IS NULL;

ALTER TABLE public.category_markup ENABLE ROW LEVEL SECURITY;

-- Read by the storefront? No. This is cost-side data: it tells anyone who can
-- read it exactly what the store pays for everything it sells.
DROP POLICY IF EXISTS "Admins manage category markup" ON public.category_markup;
CREATE POLICY "Admins manage category markup" ON public.category_markup
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- Seeded from the value already in force, so this migration changes no price
-- on the day it runs. Whoever tunes these is making a deliberate decision, not
-- discovering one that was made for them.
INSERT INTO public.category_markup (category, percent, note)
SELECT NULL,
       coalesce(nullif((SELECT value FROM public.store_settings WHERE key = 'axiz_markup_pct'), ''), '17')::numeric,
       'Fallback for any category without its own rule. Seeded from the previous store-wide markup.'
WHERE NOT EXISTS (SELECT 1 FROM public.category_markup WHERE category IS NULL);

/**
 * The markup to apply to a category, as a percentage.
 *
 * STABLE and exact-matching. Used by the catalogue sync on every product of
 * every page, so it must be cheap and must never surprise.
 */
CREATE OR REPLACE FUNCTION public.markup_for_category(p_category text)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(
    (SELECT percent FROM public.category_markup
      WHERE category IS NOT NULL
        AND lower(btrim(category)) = lower(btrim(coalesce(p_category, '')))
      LIMIT 1),
    (SELECT percent FROM public.category_markup WHERE category IS NULL LIMIT 1),
    17
  );
$$;

/**
 * What every category currently costs and earns, for the admin sourcing screen.
 *
 * Aggregated in the database rather than in the browser because the alternative
 * is shipping every active product to the client to add up -- which is how the
 * photo screen came to silently work on the first 1,000 rows only.
 */
CREATE OR REPLACE VIEW public.category_pricing_summary AS
SELECT
  coalesce(p.category, '(uncategorised)')        AS category,
  count(*)                                      AS products,
  count(*) FILTER (WHERE p.in_stock)            AS in_stock,
  round(avg(p.price), 2)                        AS avg_price,
  round(min(p.price), 2)                        AS min_price,
  round(max(p.price), 2)                        AS max_price,
  round(avg(c.cost_price), 2)                   AS avg_cost,
  -- Realised margin, not the markup that was applied. Cost 1000 marked up 17%
  -- sells at 1170 and realises 14.5%; reporting 17% here is the classic way to
  -- believe a catalogue is more profitable than it is.
  round(avg(CASE WHEN p.price > 0 AND c.cost_price IS NOT NULL
                 THEN (p.price - c.cost_price) / p.price * 100 END), 1) AS avg_margin_pct,
  public.markup_for_category(p.category)        AS markup_pct,
  count(*) FILTER (WHERE c.cost_price IS NOT NULL AND p.price < c.cost_price) AS below_cost,
  count(*) FILTER (WHERE p.last_synced_at IS NULL OR p.last_synced_at < now() - interval '7 days') AS stale
FROM public.products p
LEFT JOIN public.product_costs c ON c.product_id = p.id
WHERE p.is_active
GROUP BY p.category;

-- No direct grant, to anybody.
--
-- This view joins product_costs, so every row of it says what the store pays
-- for something it sells. Granting SELECT to `authenticated` would hand the
-- store's entire cost base to any customer who signs up for an account and
-- knows the view's name -- and a Supabase project publishes its schema, so
-- knowing the name takes one request. The RLS on product_costs does not save
-- us either: a view executes with its owner's rights, so it reads straight
-- past the policy that protects the table.
--
-- The SECURITY DEFINER function below, which checks the caller is an admin
-- before returning a single row, is the only way in.
REVOKE ALL ON public.category_pricing_summary FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.get_category_pricing()
RETURNS SETOF public.category_pricing_summary
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT * FROM public.category_pricing_summary
   WHERE public.has_role(auth.uid(), 'admin'::app_role)
   ORDER BY products DESC;
$$;

REVOKE ALL ON FUNCTION public.get_category_pricing() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_category_pricing() TO authenticated;
