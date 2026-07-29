-- Canonical product category classification.
--
-- The problem: Axiz returns "accessories" as productCategory for essentially
-- the whole feed, and axiz-sync wrote `category: item.productCategory` on every
-- upsert. So 97% of the live catalogue sat in one bucket:
--
--   accessories  3 412 of 3 495 active products
--
-- `recategorize_batch()` already existed and classifies correctly, but it was a
-- one-shot backfill and the very next sync overwrote every value it had fixed.
-- That is why "Laptops" and the other real categories kept disappearing from
-- the filters no matter how many times the backfill was run.
--
-- The fix is to stop treating classification as a batch job and make it an
-- invariant of the table. One function is the single source of truth, a trigger
-- applies it on write, and the backfill reuses it — so the sync can keep
-- sending whatever the distributor says and the catalogue still lands in the
-- right place.
--
-- The trigger only refines GENERIC categories (null, blank, "accessories",
-- "Accessories (General)"). A specific category — "Smart Home" on a manual
-- import, or an admin's deliberate edit — is left exactly as set.

CREATE OR REPLACE FUNCTION public.classify_product_category(p_name text, p_category text DEFAULT NULL)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    -- A category that already says something specific wins, but is first
    -- folded onto its canonical spelling. Without this the facet list
    -- fragments into "Laptops" / "Laptop" / "laptop" as three separate
    -- filters holding one product each -- which is precisely the kind of
    -- broken filter this whole change exists to stop.
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

    -- Order matters: narrower, higher-signal patterns first. A "Cable" line
    -- that also mentions "Server" is a cable, not a server.
    WHEN p_name ~* '(SVC$|\mFC[0-9]Y\M|NBDExch|NBD Exch|Foundation Care|Care Pack|Warranty|Warr\.|Support Service)' THEN 'Support & Warranty'
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
    WHEN p_name ~* '(Server|\mSvr\M|Rack|\mUPS\M|\mPDU\M|Chassis|Blade|Rail Kit|Fan Kit|Riser)' THEN 'Servers & Data Centre'
    ELSE 'Accessories (General)'
  END;
$function$;

COMMENT ON FUNCTION public.classify_product_category(text, text) IS
  'Single source of truth for product categorisation. Returns p_category unchanged when it is already specific; otherwise derives a category from the product name. Used by both the products_classify_category trigger and recategorize_batch().';

-- Apply on write, so a distributor sync can never undo the classification.
CREATE OR REPLACE FUNCTION public.products_set_category()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  NEW.category := public.classify_product_category(NEW.name, NEW.category);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS products_classify_category ON public.products;
CREATE TRIGGER products_classify_category
  BEFORE INSERT OR UPDATE OF name, category ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.products_set_category();

-- Reuse the same logic for the backfill, so the two can never drift apart.
CREATE OR REPLACE FUNCTION public.recategorize_batch(batch_size integer DEFAULT 3000)
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
    SELECT id FROM public.products
    WHERE is_active = true
      AND (category IS NULL
           OR btrim(category) = ''
           OR lower(btrim(category)) IN ('accessories', 'accessories (general)'))
    LIMIT batch_size
  )
  UPDATE public.products p
     SET category = public.classify_product_category(p.name, NULL)
    FROM batch
   WHERE p.id = batch.id;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$function$;
