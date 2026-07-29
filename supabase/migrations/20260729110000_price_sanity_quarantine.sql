-- Price-sanity quarantine for distributor feed artefacts.
--
-- The Axiz feed carries non-sellable line items (licence/registration "Trk"
-- SKUs) alongside real products, and axiz-sync published anything with
-- `cost > 0 && images.length > 0`. That put six HPE enterprise SKUs on the
-- consumer storefront at R29.54 with a working Add-to-cart button:
--
--   HPE Alletra 6010 / 6030 / 6050 / 6070 AF DC TR Base Array   R29.54
--   HPE DL325 G10+ v2 NVMe for Weka Base Trk                    R29.54
--   HPE DL380 G10+ 8LFF NC Svr CVLT HSX Trk                     R29.60
--
-- Selling a six-figure storage array for R29.54 is not a cosmetic bug: under
-- the Consumer Protection Act a displayed price is an offer, and the store
-- would be arguing about whether it has to honour it. This quarantines such
-- rows instead of deleting them, so an admin can review and republish with a
-- corrected price.
--
-- Deliberately ONE rule: an absolute floor.
--
-- A brand+category median-outlier rule was built and tested first, and
-- rejected on the evidence. Axiz dumps almost the entire catalogue into a
-- single "accessories" category, so the HPE/accessories "cohort" spans R112
-- power cords to R24m storage arrays and its median (R56 183) describes
-- nothing. The rule flagged 100+ perfectly legitimate cables, power cords and
-- mount kits. A guard that deactivates real stock is worse than no guard.
-- Revisit only if the category taxonomy ever becomes fine-grained enough for
-- a cohort median to be meaningful.

INSERT INTO store_settings (key, value)
VALUES ('min_sellable_price', '50')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.quarantine_mispriced_products(dry_run boolean DEFAULT false)
RETURNS TABLE(product_id uuid, name text, brand text, category text, price numeric, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET statement_timeout TO '120s'
AS $function$
DECLARE
  v_floor numeric := COALESCE(
    (SELECT value::numeric FROM store_settings WHERE key = 'min_sellable_price'), 50);
BEGIN
  RETURN QUERY
  WITH flagged AS (
    SELECT p.id, p.name, p.brand, p.category, p.price,
           format('below_min_sellable_price (R%s < R%s)', p.price, v_floor) AS reason
    FROM products p
    WHERE p.is_active AND p.price < v_floor
  ),
  deactivated AS (
    UPDATE products p
       SET is_active = false
      FROM flagged f
     WHERE p.id = f.id AND NOT dry_run
    RETURNING p.id
  ),
  logged AS (
    INSERT INTO automation_events (source, event_type, status, error_message, payload)
    SELECT 'price-sanity',
           'product.quarantined',
           CASE WHEN dry_run THEN 'skipped' ELSE 'success' END,
           f.reason,
           jsonb_build_object(
             'product_id', f.id, 'sku_name', f.name, 'brand', f.brand,
             'category', f.category, 'price', f.price, 'dry_run', dry_run
           )
    FROM flagged f
    RETURNING 1
  )
  SELECT f.id, f.name, f.brand, f.category, f.price, f.reason
  FROM flagged f
  -- Forces the data-modifying CTEs to run even when the caller ignores rows.
  WHERE (SELECT count(*) FROM deactivated) >= 0
    AND (SELECT count(*) FROM logged) >= 0
  ORDER BY f.price;
END;
$function$;

REVOKE ALL ON FUNCTION public.quarantine_mispriced_products(boolean) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quarantine_mispriced_products(boolean) TO service_role;

COMMENT ON FUNCTION public.quarantine_mispriced_products(boolean) IS
  'Deactivates active products priced below store_settings.min_sellable_price (distributor feed artefacts). Pass dry_run => true to preview. Every decision is logged to automation_events (source=price-sanity).';
