-- Photography for the Our Story page, set by the owner rather than shipped.
--
-- The two frames on /about -- the founder and Gelvandale -- take real
-- photographs. They belong in settings rather than in the bundle for a reason
-- that is not convenience: they are the owner's own photographs of his own
-- town, and replacing one must not require a developer, a build or a deploy.
--
-- The values are public storage URLs and nothing else. They are added to the
-- read whitelist, not the whole table: /about is served to anonymous visitors,
-- so the page cannot read a key the anon role cannot select, and widening the
-- policy to the whole table to solve that would expose every operational
-- setting sitting beside these two.

INSERT INTO store_settings (key, value)
VALUES ('about_hero_image', ''), ('about_place_image', '')
ON CONFLICT (key) DO NOTHING;

DROP POLICY IF EXISTS "Anyone can view public store settings" ON store_settings;

CREATE POLICY "Anyone can view public store settings"
ON store_settings
FOR SELECT
TO public
USING (
  key = ANY (ARRAY[
    'shipping_flat_rate'::text,
    'free_shipping_threshold'::text,
    'shipping_zones'::text,
    'shipping_rate_table'::text,
    'dispatch_city'::text,
    'payfast_enabled'::text,
    'about_hero_image'::text,
    'about_place_image'::text
  ])
);
