-- Feature flag gating the PayFast / Capitec Pay option in checkout.
--
-- The checkout UI must not offer Capitec Pay until PAYFAST_MERCHANT_ID and
-- PAYFAST_MERCHANT_KEY are actually configured -- otherwise a shopper can
-- select it and hit "PayFast not configured" from create-payfast-checkout.
--
-- Defaults to 'false'. Flip to 'true' from Admin Settings (or with an update
-- here) only once the PayFast credentials are live.

INSERT INTO store_settings (key, value)
VALUES ('payfast_enabled', 'false')
ON CONFLICT (key) DO NOTHING;

-- Add the flag to the public-read whitelist so anonymous shoppers can read it
-- at checkout. It is a boolean feature flag, never a credential -- the actual
-- merchant id/key stay in edge-function secrets and are never client-readable.
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
    'payfast_enabled'::text
  ])
);
