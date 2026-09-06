-- The live "Anyone can view public store settings" policy was a fixed list
-- of 9 exact key names, with no 'merch.%' or 'seo.%' wildcard clause at all --
-- despite two migrations (20260729160000, 20260812153000) explicitly
-- documenting that merchandising weights and 'merch.business.%' fall under
-- such a clause, and useStoreFlag() documenting the same for 'seo.%'. Neither
-- migration's version of this policy had actually reached production; this is
-- the same class of drift as the products RLS fix from earlier today.
--
-- Concretely broken by this: useStoreFlag("seo.content_engine") always reads
-- as false for every anonymous visitor and for Google's crawler, regardless
-- of what the row's value is set to -- RLS silently returns zero rows rather
-- than an error, which is indistinguishable from "flag off" at the call site.
-- The home page's own merchandising scoring (score_home_product /
-- score_business_product) has the identical problem reading merch.weight.*
-- and merch.business.* for anyone not logged in as admin: the admin preview
-- and the live anonymous page were never guaranteed to match.
--
-- These are merchandising dials and feature flags, not secrets -- the
-- decision to make them public was already made and documented twice; this
-- migration is what actually applies it.
DROP POLICY IF EXISTS "Anyone can view public store settings" ON public.store_settings;
CREATE POLICY "Anyone can view public store settings"
  ON public.store_settings FOR SELECT
  USING (
    key = ANY (ARRAY[
      'shipping_flat_rate', 'free_shipping_threshold', 'shipping_zones',
      'shipping_rate_table', 'dispatch_city', 'payfast_enabled',
      'yoco_enabled', 'about_hero_image', 'about_place_image'
    ])
    OR key LIKE 'merch.%'
    OR key LIKE 'seo.%'
  );
