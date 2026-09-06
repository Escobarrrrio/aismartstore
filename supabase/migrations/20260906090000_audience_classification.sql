-- Audience classification, and two category fixes it depends on.
--
-- The problem: audience was decided in axiz-sync by price alone --
--   laptops: <= R25 000 -> residential, everything else <= R15 000
-- with no reference to what the product actually is. On the live catalogue
-- that put 520 pieces of enterprise kit in front of household shoppers:
-- RHEL subscriptions, Aruba campus APs, LTO tape labels, ProLiant riser
-- kits, DAC cables. An HPE MSR930 Chassis Rackmount Kit was tagged
-- 'residential' while its own category column read 'Servers & Data Centre'
-- -- the answer was already in the row, and the sync asked "is it cheap?"
-- instead of reading it.
--
-- This follows the pattern already established for category by
-- classify_product_category: one function is the source of truth, a trigger
-- makes it an invariant of the table so a sync cannot undo it, and the
-- backfill reuses the same function so the two cannot drift.
--
-- Known limitation, stated rather than hidden: audience is derived, so an
-- admin who overrides it by hand keeps that value only until the next write
-- touching name, category or price. If deliberate overrides are needed, the
-- honest fix is an `audience_locked` column rather than weakening the rule.

-- ---------------------------------------------------------------------
-- 1. Category fixes
-- ---------------------------------------------------------------------
-- (a) Bare "Warranty" matched anywhere in a name sent physical products to
--     'Support & Warranty'. A Logitech MK120 keyboard whose blurb ends
--     "...3-year Limited hardware warranty" was filed as a warranty product.
--     Genuine care-pack SKUs are already caught by SVC$, Care Pack,
--     Foundation Care and NBD, so the loose keyword only cost accuracy.
-- (b) 'Tower' (a desktop pattern) was tested before 'UPS', so
--     "HPE T1500 G5 INTL Tower UPS" classified as a desktop workstation.
--     Power infrastructure is now matched first.
CREATE OR REPLACE FUNCTION public.classify_product_category(p_name text, p_category text DEFAULT NULL)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN p_category IS NOT NULL
     AND btrim(p_category) <> ''
     AND lower(btrim(p_category)) NOT IN ('accessories', 'accessories (general)')
      THEN CASE lower(btrim(p_category))
        WHEN 'laptop'            THEN 'Laptops'
        WHEN 'laptops'           THEN 'Laptops'
        WHEN 'notebooks'         THEN 'Laptops'
        WHEN 'cables'            THEN 'Cables & Connectivity'
        WHEN 'server'            THEN 'Servers & Data Centre'
        WHEN 'servers'           THEN 'Servers & Data Centre'
        WHEN 'monitors'          THEN 'Monitors & Displays'
        WHEN 'displays'          THEN 'Monitors & Displays'
        WHEN 'storage devices'   THEN 'Storage'
        WHEN 'storage'           THEN 'Storage'
        WHEN 'memory'            THEN 'Memory'
        WHEN 'networking'        THEN 'Networking'
        WHEN 'peripherals'       THEN 'Peripherals'
        WHEN 'care packs'        THEN 'Support & Warranty'
        WHEN 'care pack'         THEN 'Support & Warranty'
        WHEN 'support'           THEN 'Support & Warranty'
        WHEN 'software'          THEN 'Software & Licensing'
        WHEN 'printers'          THEN 'Printers & Scanners'
        ELSE btrim(p_category)
      END

    WHEN p_name IS NULL OR btrim(p_name) = '' THEN 'Accessories (General)'

    -- Power infrastructure before the desktop patterns: a "Tower UPS" is a
    -- UPS, not a tower PC.
    WHEN p_name ~* '(\mUPS\M|\mPDU\M|Uninterruptible)' THEN 'Servers & Data Centre'

    -- Service SKUs. "Warranty" on its own is deliberately absent: it appears
    -- in the marketing copy of ordinary hardware.
    WHEN p_name ~* '(SVC$|\mFC[0-9]Y\M|NBDExch|NBD Exch|Foundation Care|Care Pack|Proactive Care|Tech Care|Warranty Extension|Extended Warranty|Warranty Upgrade|Warr\.|Support Service)' THEN 'Support & Warranty'
    WHEN p_name ~* '(License|Licence|Subscription|SaaS|E-LTU|LTU\M|Monthly Payment|Per User|Office 365|Microsoft 365|Azure|Windows Server)' THEN 'Software & Licensing'
    WHEN p_name ~* '(Cable|Cbl|Pwr Cord|Power Cord|Patch Cord|Fiber Patch|Jumper|Jpr Cord|DAC\M|Transceiver|XCVR|SFP)' THEN 'Cables & Connectivity'
    WHEN p_name ~* '(Toner|Ink Cart|Cartridge|Drum|Fuser)' THEN 'Printer Consumables'
    WHEN p_name ~* '(Printer|MFP|Multifunction|Scanner)' THEN 'Printers & Scanners'
    WHEN p_name ~* '(Switch|Router|Firewall|Access Point|\mWAP\M|WiFi|Wi-Fi|Wireless|Antenna)' THEN 'Networking'
    WHEN p_name ~* '(GPU|Graphics Card|Quadro|RTX|GeForce|Radeon|Tesla|A100|H100|Accelerator)' THEN 'GPUs & AI Accelerators'
    WHEN p_name ~* '(Laptop|Notebook|ProBook|EliteBook|ThinkPad|Latitude|Precision|ZBook)' THEN 'Laptops'
    WHEN p_name ~* '(Desktop|Workstation|Tower|OptiPlex|MiniPC|\mNUC\M|Micro PC)' THEN 'Desktops & Workstations'
    WHEN p_name ~* '(Monitor|Display|Screen|\mLCD\M)' THEN 'Monitors & Displays'
    WHEN p_name ~* '(Keyboard|Mouse|Headset|Webcam|Docking|Dock )' THEN 'Peripherals'
    WHEN p_name ~* '(\mRAM\M|Memory|DIMM|SODIMM|\mDDR)' THEN 'Memory'
    WHEN p_name ~* '(\mSSD\M|\mHDD\M|Hard Drive|Solid State|NVMe|Storage|\mSAN\M|\mNAS\M|Data Cartridge|LTO-)' THEN 'Storage'
    WHEN p_name ~* '(Camera|CCTV|Surveillance|IP Cam)' THEN 'Security & Surveillance'
    WHEN p_name ~* '(Server|\mSvr\M|Rack|Chassis|Blade|Rail Kit|Fan Kit|Riser)' THEN 'Servers & Data Centre'
    ELSE 'Accessories (General)'
  END;
$function$;

-- ---------------------------------------------------------------------
-- 2. Audience classification
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.classify_product_audience(
  p_name text,
  p_category text DEFAULT NULL,
  p_price numeric DEFAULT 0
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    -- Categories that are enterprise by definition. Category is derived by
    -- classify_product_category, so this reads the same canonical values the
    -- storefront filters on.
    WHEN p_category IN ('Servers & Data Centre', 'Software & Licensing', 'Support & Warranty')
      THEN 'business'

    -- Enterprise signals in the name, at any price. This is the case the old
    -- price rule got backwards: a R64 multi-mode LC/LC fibre lead is data
    -- centre kit, and being cheap is not evidence that a household wants it.
    WHEN p_name ~* '(ProLiant|Synergy|Superdome|BladeSystem|Apollo|Alletra|Nimble|3PAR|Primera|StoreOnce|StoreEver|\mMSA\M)'
      OR p_name ~* '(RHEL|Red Hat|VMware|vSphere|vCenter|Nutanix|Citrix|Hyper-V|Windows Server|\mCAL\M|Datacenter|Datacentre)'
      OR p_name ~* '(E-LTU|\mLTU\M|Care Pack|Foundation Care|Proactive Care|Tech Care|\mNBD\M|NBDExch)'
      -- "Blade" must mean a blade server: "XPG Lancer Blade" is gaming RAM.
      OR p_name ~* '(Rackmount|Rack Mount|\mRack\M|Chassis|BladeSystem|Blade Server|\mBL[0-9]{3}|Riser|Rail Kit|\mPDU\M|\mUPS\M|\mKVM\M|\m[1-9]U\M)'
      OR p_name ~* '(\mSFP\M|QSFP|Transceiver|\mXCVR\M|\mDAC\M|Fibre Channel|Fiber Channel|InfiniBand|Multi-mode|Multimode|\mOM[34]\M|LC/LC)'
      OR p_name ~* '(\mLTO\M|Autoloader|\mJBOD\M|\mSAN\M|Smart Array|Tape Drive|Tape Library)'
      OR p_name ~* '(Aruba|ClearPass|FlexNetwork|FlexFabric|\mIMC\M|\mMSR[0-9])'
      OR p_name ~* '(RDIMM|LRDIMM|\mECC\M|Registered DIMM)'
      OR p_name ~* '(Enterprise|\mServer\M|\mSvr\M)'
      THEN 'business'

    -- Categories a household shopper genuinely buys from. A consumer laptop
    -- stays consumer at R26 000; the old flat cutoff pushed it to the
    -- business portal purely for being expensive.
    WHEN p_category IN ('Peripherals', 'Printer Consumables', 'Printers & Scanners',
                        'Monitors & Displays', 'Laptops', 'Desktops & Workstations',
                        'Security & Surveillance', 'Flash Drives', 'External Hard Drives')
      THEN 'residential'

    -- Only for genuinely ambiguous stock -- a plain cable, some RAM, an
    -- unclassified accessory -- does price act as the tiebreaker.
    WHEN coalesce(p_price, 0) <= 15000 THEN 'residential'
    ELSE 'business'
  END;
$function$;

COMMENT ON FUNCTION public.classify_product_audience(text, text, numeric) IS
  'Single source of truth for residential/business split. Category and explicit enterprise signals decide; price is only a tiebreaker for ambiguous stock. Used by the products_classify_audience trigger and reclassify_audience_batch().';

-- Applied on write, so a distributor sync cannot undo it -- the same
-- guarantee products_classify_category already gives category. Category is
-- recomputed first here because audience depends on it, and trigger order
-- within a BEFORE trigger is alphabetical by trigger name:
-- products_classify_audience would otherwise read the previous category.
CREATE OR REPLACE FUNCTION public.products_set_audience()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  NEW.category := public.classify_product_category(NEW.name, NEW.category);
  NEW.audience := public.classify_product_audience(NEW.name, NEW.category, NEW.price);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS products_classify_audience ON public.products;
CREATE TRIGGER products_classify_audience
  BEFORE INSERT OR UPDATE OF name, category, price ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.products_set_audience();

-- Same logic for the backfill, so the two cannot drift apart.
CREATE OR REPLACE FUNCTION public.reclassify_audience_batch(batch_size integer DEFAULT 5000)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET statement_timeout TO '120s'
AS $function$
DECLARE
  updated_count int;
BEGIN
  WITH batch AS (
    SELECT id, name, category, price
    FROM public.products
    WHERE audience IS DISTINCT FROM
          public.classify_product_audience(name, public.classify_product_category(name, category), price)
    LIMIT batch_size
  )
  UPDATE public.products p
     SET category = public.classify_product_category(b.name, b.category),
         audience = public.classify_product_audience(
                      b.name, public.classify_product_category(b.name, b.category), b.price)
    FROM batch b
   WHERE p.id = b.id;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.reclassify_audience_batch(integer) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------
-- 3. Repair rows the two category bugs already mis-filed
-- ---------------------------------------------------------------------
-- classify_product_category leaves an already-specific category alone, so
-- that an admin's deliberate edit survives a sync. That protection also
-- means the fixes above only apply to future writes -- the rows already
-- mis-filed keep their wrong value, and since 'Support & Warranty' maps to
-- business, they would stay wrongly hidden from consumers.
--
-- These two repairs are deliberately narrow rather than a blanket
-- re-derive: each targets a pattern that is provably wrong (a keyboard is
-- not a warranty; a UPS is not a desktop), so the chance of overwriting a
-- considered human decision is negligible. A blanket re-derive would have
-- thrown away every deliberate categorisation in the catalogue.

-- (a) Physical products swept into 'Support & Warranty' by the bare
--     "Warranty" keyword -- e.g. a Logitech MK120 keyboard whose description
--     ends "...3-year Limited hardware warranty". Re-derived from the name.
UPDATE public.products
   SET category = public.classify_product_category(name, NULL)
 WHERE category = 'Support & Warranty'
   AND name !~* '(SVC$|\mFC[0-9]Y\M|NBDExch|NBD Exch|Foundation Care|Care Pack|Proactive Care|Tech Care|Warranty Extension|Extended Warranty|Warranty Upgrade|Warr\.|Support Service)';

-- (b) UPS/PDU units filed as desktop workstations because 'Tower' was
--     tested before 'UPS'.
UPDATE public.products
   SET category = 'Servers & Data Centre'
 WHERE category = 'Desktops & Workstations'
   AND name ~* '(\mUPS\M|\mPDU\M|Uninterruptible)';

-- ---------------------------------------------------------------------
-- 4. Backfill audience across the existing catalogue
-- ---------------------------------------------------------------------
-- Runs last: audience is derived from category, so the repairs above have
-- to land first or this would classify from the wrong input.
SELECT public.reclassify_audience_batch(10000);
