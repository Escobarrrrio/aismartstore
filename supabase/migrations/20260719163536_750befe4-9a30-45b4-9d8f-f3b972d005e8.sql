
DROP POLICY IF EXISTS "Anyone can view public store settings" ON public.store_settings;
CREATE POLICY "Anyone can view public store settings" ON public.store_settings
  FOR SELECT USING (key = ANY (ARRAY[
    'shipping_flat_rate','free_shipping_threshold','shipping_zones','shipping_rate_table'
  ]));
