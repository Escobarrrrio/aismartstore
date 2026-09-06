-- Three things: a lock so a human decision outranks the classifier, a
-- classifier that understands the distributor's abbreviations, and a search
-- box that is fast and can be asked for an exact phrase.

-- =====================================================================
-- 1. audience_locked -- deliberate overrides stop being overwritten
-- =====================================================================
-- classify_product_audience() runs on every write touching name, category or
-- price, which is what stops a sync undoing it. The cost was that a human
-- correction survived only until the next sync. A derived value and a
-- deliberate exception need somewhere separate to live, so: set the flag and
-- the row keeps whatever audience you gave it, permanently.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS audience_locked boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.products.audience_locked IS
  'When true, classify_product_audience() will not touch this row. Set it when a human has deliberately overridden the automatic residential/business split.';

-- =====================================================================
-- 2. Category classification for the distributor's real vocabulary
-- =====================================================================
-- 1161 active products (27% of the catalogue) sat in 'Accessories (General)'
-- because the patterns were written for English words and Axiz ships
-- abbreviations: "Swch" not Switch, "Pwr Crd" not Power Cord, "Adptr" not
-- Adapter, "Mt Kit" not Mount. Consumer peripherals were worse -- Logitech
-- arrives as "MX Anywhere 3 - ROSE - 2.4GHZ/BT - N/A - EMEA", where nothing
-- matched, so a mouse classified as nothing at all.
--
-- These rules resolve 1000 of the 1161. The remaining 161 are genuine
-- miscellany; inventing patterns to force them somewhere would be
-- overfitting to individual SKUs rather than classification.
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

    -- Consumer peripherals first, by product line. These arrive in a dashed
    -- distributor format with no matchable English word.
    WHEN p_name ~* '(MX Anywhere|MX Master|MX Keys|Unifying|MeetUp|Rally|Zone Wired|Zone Vibe|Litra|StreamCam|\mBrio\M|Ergo K|Pebble|Signature)' THEN 'Peripherals'

    -- Power infrastructure before the desktop patterns: a "Tower UPS" is a
    -- UPS, not a tower PC.
    WHEN p_name ~* '(\mUPS\M|\mPDU\M|Uninterruptible|\mPSU\M|Power Supply|Pwr Crd|Pwr Cord|Power Cord|Pwr2Prt|Power Shelf|Redundant Power|\mRPS[0-9])' THEN 'Power & Cooling'
    WHEN p_name ~* '(\mFan\M|Fan Kit|Heatsink|Heat Sink|Cooling)' THEN 'Power & Cooling'

    -- Service SKUs. "Warranty" on its own is deliberately absent: it appears
    -- in the marketing copy of ordinary hardware, which is how a Logitech
    -- MK120 keyboard ended up filed as a warranty product.
    WHEN p_name ~* '(SVC$|\mFC[0-9]Y\M|NBDExch|NBD Exch|Foundation Care|Care Pack|Proactive Care|Tech Care|Warranty Extension|Extended Warranty|Warranty Upgrade|Warr\.|Support Service)' THEN 'Support & Warranty'
    WHEN p_name ~* '(License|Licence|Subscription|SaaS|E-LTU|LTU\M|Monthly Payment|Per User|Office 365|Microsoft 365|Azure|Windows Server|Veeam|Kasten|Commvault|Veritas|Acronis|Rubrik)' THEN 'Software & Licensing'

    -- Processors: Xeon/EPYC "Kit for ..." SKUs are a large distinct group
    -- with no home in the taxonomy before now.
    WHEN p_name ~* '(\mXeon\M|\mEPYC\M|\mCPU\M|Processor|Threadripper|\mRyzen\M|Core i[3579])' THEN 'Processors'

    WHEN p_name ~* '(Toner|Ink Cart|Cartridge|Drum|Fuser)' THEN 'Printer Consumables'
    WHEN p_name ~* '(Printer|MFP|Multifunction|Scanner)' THEN 'Printers & Scanners'

    -- Networking, including abbreviated switch spellings, chassis modules
    -- and pre-built bundles the old \mSwitch\M pattern could never match.
    WHEN p_name ~* '(\mSwch\M|\mSwtch\M|Switch|Router|Firewall|Access Point|\mAP-|\mWAP\M|WiFi|Wi-Fi|Wireless|Antenna|\mANT-|\mdBi\M|SD-WAN|Gateway)' THEN 'Networking'
    WHEN p_name ~* '(Adptr|Adapter|BASE-T|\mNIC\M|Network Card|Ethernet)' THEN 'Networking'
    WHEN p_name ~* '(Main Processing Unit|\mMPU\M|\mHMIM\M|Pltfrm Mod|Fabric Mod|\mBdl\M|Bundle)' THEN 'Networking'

    WHEN p_name ~* '(GPU|Graphics Card|Quadro|RTX|GeForce|Radeon|Tesla|A100|H100|Accelerator)' THEN 'GPUs & AI Accelerators'
    WHEN p_name ~* '(Cable|Cbl|Patch Cord|Fiber Patch|Jumper|Jpr Cord|\mDAC\M|Transceiver|XCVR|SFP|QSFP|\mAOC\M|Q-DD)' THEN 'Cables & Connectivity'
    WHEN p_name ~* '(Laptop|Notebook|ProBook|EliteBook|ThinkPad|Latitude|Precision|ZBook)' THEN 'Laptops'
    WHEN p_name ~* '(Desktop|Workstation|Tower|OptiPlex|MiniPC|\mNUC\M|Micro PC)' THEN 'Desktops & Workstations'
    WHEN p_name ~* '(Monitor|Display|Screen|\mLCD\M)' THEN 'Monitors & Displays'
    WHEN p_name ~* '(Keyboard|Mouse|Headset|Webcam|Docking|Dock )' THEN 'Peripherals'
    WHEN p_name ~* '(\mRAM\M|Memory|DIMM|SODIMM|\mDDR)' THEN 'Memory'

    -- Storage, including tape libraries, drive sleds, optical drives and
    -- disk arrays.
    WHEN p_name ~* '(Spectra|\mLib\M|Library|Drv Sled|Drive Sled|\mLTO\M|\mTS[0-9]{4}\M|Autoloader)' THEN 'Storage'
    WHEN p_name ~* '(DVD|Blu-?ray|Opt Drive|Optical Drive)' THEN 'Storage'
    WHEN p_name ~* '(Alletra|Qumulo|Nimble|Primera|StoreOnce|StoreEver|3PAR|\mMSA\M|\mArray\M)' THEN 'Storage'
    WHEN p_name ~* '(Controller|\mHBA\M|\mRAID\M|Drive Cage|Backplane|\mSFF\M|\mLFF\M|Smart Array)' THEN 'Storage'
    WHEN p_name ~* '(\mSSD\M|\mHDD\M|Hard Drive|Solid State|NVMe|Storage|\mSAN\M|\mNAS\M|Data Cartridge|LTO-)' THEN 'Storage'

    WHEN p_name ~* '(Camera|CCTV|Surveillance|IP Cam)' THEN 'Security & Surveillance'
    WHEN p_name ~* '(Server|\mSvr\M|Rack|Chassis|Blade|Rail Kit|\mRail\M|Riser|\mMt Kit\M|\mMNT\M|Mount|Bracket|Tray|Frame)' THEN 'Servers & Data Centre'
    ELSE 'Accessories (General)'
  END;
$function$;

-- Audience: unchanged logic, but now yields to audience_locked.
CREATE OR REPLACE FUNCTION public.products_set_audience()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  NEW.category := public.classify_product_category(NEW.name, NEW.category);
  -- A locked row keeps the audience a human gave it. Category is still
  -- refreshed: locking the split is not a reason to let the category rot.
  IF NOT coalesce(NEW.audience_locked, false) THEN
    NEW.audience := public.classify_product_audience(NEW.name, NEW.category, NEW.price);
  END IF;
  RETURN NEW;
END;
$function$;

-- The backfill must respect the lock too, or it would undo by batch exactly
-- what the flag exists to protect.
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
    WHERE coalesce(audience_locked, false) = false
      AND (category IS DISTINCT FROM public.classify_product_category(name, category)
        OR audience IS DISTINCT FROM public.classify_product_audience(
             name, public.classify_product_category(name, category), price))
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

-- Re-derive the 1161 that the old patterns left in the generic bucket.
UPDATE public.products
   SET category = public.classify_product_category(name, NULL)
 WHERE is_active = true
   AND (category IS NULL OR btrim(category) = ''
        OR lower(btrim(category)) IN ('accessories', 'accessories (general)'));

-- =====================================================================
-- 3. Search: fast, and able to be asked for an exact phrase
-- =====================================================================
-- Two problems. search_products matches `p.name % search_query` and orders by
-- similarity(), but products_name_trgm_idx was never actually created on this
-- database -- the migration that declares it is one of many that never
-- applied -- so every search sequentially scanned the catalogue. A plain
-- two-word query measured 286ms.
--
-- And sku was missing from search_vector entirely, so a customer typing a
-- product code could only ever be found by the unindexed trigram path.
CREATE INDEX IF NOT EXISTS products_name_trgm_idx
  ON public.products USING GIN (name gin_trgm_ops);

-- Rebuild the generated column to include sku (weight A -- a product code is
-- as strong a signal as the name) and brand.
DROP INDEX IF EXISTS products_search_vector_idx;
ALTER TABLE public.products DROP COLUMN IF EXISTS search_vector;
ALTER TABLE public.products ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(sku, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(brand, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(category, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'C')
  ) STORED;
CREATE INDEX products_search_vector_idx ON public.products USING GIN (search_vector);

-- websearch_to_tsquery, not plainto_tsquery: it gives shoppers the syntax
-- they already expect from a search box -- "exact phrase" in quotes, OR, and
-- -exclusion -- and, like plainto_, it never raises on malformed input, so a
-- stray quote cannot 500 the catalogue.
CREATE OR REPLACE FUNCTION public.search_products(search_query text DEFAULT ''::text, filter_category text DEFAULT NULL::text, filter_brand text DEFAULT NULL::text, filter_ai_only boolean DEFAULT false, filter_in_stock_only boolean DEFAULT false, min_price numeric DEFAULT NULL::numeric, max_price numeric DEFAULT NULL::numeric, sort_by text DEFAULT 'relevance'::text, page_number integer DEFAULT 0, page_size integer DEFAULT 24, filter_audience text DEFAULT 'residential'::text)
 RETURNS TABLE(id uuid, sku text, slug text, name text, description text, price numeric, category text, brand text, stock_quantity integer, in_stock boolean, images text[], is_ai_product boolean, audience text, total_count bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  has_search  boolean := btrim(coalesce(search_query, '')) <> '';
  ts_query    tsquery;
  v_sort      text := coalesce(sort_by, 'relevance');
  -- Unchanged: an unauthenticated caller is clamped to the residential
  -- catalogue no matter what audience they ask for.
  v_audience  text := CASE WHEN auth.uid() IS NULL
                           THEN 'residential'
                           ELSE lower(coalesce(filter_audience, 'residential')) END;
BEGIN
  IF has_search THEN
    ts_query := websearch_to_tsquery('english', search_query);
  END IF;

  RETURN QUERY
    SELECT p.id, p.sku, p.slug, p.name, p.description, p.price,
           p.category, p.brand, p.stock_quantity, p.in_stock,
           p.images, p.is_ai_product, p.audience,
           count(*) OVER() AS total_count
    FROM public.products p
    WHERE p.is_active = true
      AND (v_audience = 'all' OR p.audience = v_audience)
      AND (
        NOT has_search
        OR p.search_vector @@ ts_query
        OR p.name % search_query
      )
      AND (filter_category IS NULL OR lower(p.category) = lower(filter_category))
      AND (filter_brand    IS NULL OR lower(p.brand)    = lower(filter_brand))
      AND (NOT filter_ai_only       OR p.is_ai_product = true)
      AND (NOT filter_in_stock_only OR p.in_stock = true)
      AND (min_price IS NULL OR p.price >= min_price)
      AND (max_price IS NULL OR p.price <= max_price)
    ORDER BY
      CASE WHEN v_sort = 'relevance' AND has_search
           THEN ts_rank(p.search_vector, ts_query) + similarity(p.name, search_query)
      END DESC NULLS LAST,
      CASE WHEN v_sort = 'price_asc'  THEN p.price END ASC  NULLS LAST,
      CASE WHEN v_sort = 'price_desc' THEN p.price END DESC NULLS LAST,
      CASE WHEN v_sort = 'newest'     THEN p.last_synced_at END DESC NULLS LAST,
      p.name ASC
    LIMIT page_size OFFSET page_number * page_size;
END;
$function$;

-- Finally, re-derive audience now that categories are correct.
SELECT public.reclassify_audience_batch(10000);

ANALYZE public.products;
