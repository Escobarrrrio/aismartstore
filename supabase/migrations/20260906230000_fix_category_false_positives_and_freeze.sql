-- Two separate, compounding category bugs, both reported directly by the
-- owner off a live screenshot of /products?category=Laptops showing a car
-- charger, a privacy filter, and two laptop bags sitting on the laptops page.
--
-- BUG 1 -- classify_product_category() freezes a row's category forever.
-- Both triggers on this table call it as
--   NEW.category := classify_product_category(NEW.name, NEW.category)
-- On INSERT that's correct: NEW.category is genuinely the distributor's raw
-- taxonomy text, and the function's first branch trusts a real one verbatim.
-- On UPDATE it is not raw input any more -- it is this same function's own
-- prior output, sitting in the one column this trigger both reads and
-- writes. canonical_category('Laptops') has no case for the plural form, so
-- it falls to its own ELSE and returns 'Laptops' unchanged, which the first
-- branch of classify_product_category then treats as trusted external input
-- and hands straight back -- every time, on every future write, forever.
-- Once any row picked up a category, no later regex fix or name correction
-- could ever move it again; only a write that explicitly forces category
-- back to NULL could. Confirmed live: of the 11 accessory-named rows found
-- sitting under Laptops, the current function (called fresh with NULL) only
-- still gets 4 wrong -- the other 7 (a car charger, two docks, a stand, a
-- cable lock, two power adapters) were already correctly excluded by an
-- earlier edit to this function, but sat frozen at a category some *older*
-- version of it produced, immune to every fix since.
--
-- Fixed the same way in both triggers: pass NEW.category through only on
-- INSERT; on UPDATE, pass NULL so every write re-derives from the current
-- name against the current rules, which is what the existing comment on
-- products_set_audience ("category is still refreshed") always intended.
--
-- BUG 2 -- three bare-word regexes catch accessories that merely mention
-- compatibility with the thing they describe, confirmed against live names
-- (tested with the *current* function, NULL category, isolating this from
-- bug 1's staleness):
--
--   Laptops: 'Laptop'/'Notebook' matched with no exclusion, so a Targus
--   laptop backpack, a Targus laptop case, and an HP notebook privacy filter
--   all classify as Laptops today. None of ProBook/EliteBook/ThinkPad/
--   Latitude/Precision/ZBook is a word a bag or filter's own name would ever
--   contain, so excluding the same accessory-noun list used elsewhere in
--   this function is safe for genuine laptop models.
--
--   Networking: bare 'Adapter' matched a Dell PERC RAID Controller Adapter
--   -- a storage component this same function already has a correct
--   'RAID'/'Controller' rule for, later in the CASE, that bare 'Adapter'
--   intercepts first. Also matched five branded AC/car power adapters
--   (Antec, Vizo x2, Zalman, HP, Targus) that are chargers, not network
--   hardware -- Power & Cooling already exists as a category and just never
--   listed "adapter" as one of its own signal words.
--
--   Servers & Data Centre: bare 'Mount' matched a dozen Aavara-brand TV/
--   monitor wall-mount and mounting-column products, plus two conferencing
--   wall mounts ("Tap Wall Mount", "Wall Mount for Video Bars") -- none of
--   them a server. A server is racked, never wall-mounted, so excluding the
--   literal phrase "wall mount" is unambiguous and costs nothing: no real
--   rack-mount kit is ever phrased that way (it says "rail kit" / "rack
--   mount" / "mt kit").
--
-- Left alone, deliberately: HPE KVM/FC/serial adapters (ambiguous which
-- other bucket would be more correct, no clear evidence either way) and
-- Intel "H.S ADAPTER" heatsink kits (abbreviated enough that guessing it
-- means "heat sink" risks the exact kind of wrong-but-confident match this
-- migration exists to remove). Both fall through to their current resting
-- place, same as every other genuinely ambiguous case in this function.
CREATE OR REPLACE FUNCTION public.classify_product_category(
  p_name text,
  p_category text DEFAULT NULL
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN public.canonical_category(p_category) <> ''
     AND lower(public.canonical_category(p_category)) NOT IN ('accessories', 'accessories (general)')
      THEN public.canonical_category(p_category)

    WHEN p_name IS NULL OR btrim(p_name) = '' THEN 'Accessories (General)'

    WHEN p_name ~* '(MX Anywhere|MX Master|MX Keys|Unifying|MeetUp|Rally|Zone Wired|Zone Vibe|Litra|StreamCam|\mBrio\M|Ergo K|Pebble|Signature|Desk Mat|Mouse Pad|Mousepad|Palm Rest|Wrist Rest)' THEN 'Peripherals'

    WHEN p_name ~* '(PC[0-9]-[0-9]{4}|[0-9]+GB [0-9]Rx[0-9]|[0-9]+GB.*(Smart Kit|Smrt Kit))' THEN 'Memory'
    WHEN p_name ~* '(\mRAM\M|Memory|DIMM|SODIMM|\mDDR)' THEN 'Memory'

    -- "adapter" added here (AC/car/power adapters) so it's caught before the
    -- Networking rule's own bare "Adapter" match reaches it further down.
    WHEN p_name ~* '(\mUPS\M|\mPDU\M|Uninterruptible|\mPSU\M|Power Supply|Power Adapter|AC[- ]Adapter|Car Adapter|Car Charger|Pwr Crd|Pwr Cord|Power Cord|Pwr2Prt|Power Shelf|Redundant Power|\mRPS[0-9]|\mERM\M|Battery Module|Batt Module|C1[3-9]/C[12][0-9])' THEN 'Power & Cooling'
    WHEN p_name ~* '(\mFan\M|Fan Kit|Heatsink|Heat Sink|Cooling)' THEN 'Power & Cooling'

    WHEN p_name ~* '(SVC$|\mFC[0-9]Y\M|NBDExch|NBD Exch|Foundation Care|Care Pack|Proactive Care|Tech Care|Warranty Extension|Extended Warranty|Warranty Upgrade|Warr\.|Support Service|Deinstallation|Installation Service|Startup Service|Service$)' THEN 'Support & Warranty'
    WHEN p_name ~* '(License|Licence|Subscription|SaaS|E-LTU|LTU\M|Lic Kit|\mLic\M|Monthly Payment|Per User|Office 365|Microsoft 365|Azure|Windows Server|Veeam|Kasten|Commvault|Veritas|Acronis|Rubrik)' THEN 'Software & Licensing'

    WHEN p_name ~* '(\mXeon\M|\mEPYC\M|\mCPU\M|Processor|Threadripper|\mRyzen\M|Core i[3579])' THEN 'Processors'

    WHEN p_name ~* '(Toner|Ink Cart|Cartridge|Drum|Fuser)' THEN 'Printer Consumables'
    WHEN p_name ~* '(Printer|MFP|Multifunction|Scanner)' THEN 'Printers & Scanners'

    WHEN p_name ~* '(\mSwch\M|\mSwtch\M|Switch|Router|Firewall|Access Point|\mAP-|\mWAP\M|WiFi|Wi-Fi|Wireless|Antenna|\mANT-|\mdBi\M|SD-WAN|Gateway|Battery Beacon|Battery Tag|LTE Modem|\mModem\M|Beacon)' THEN 'Networking'
    -- Excludes RAID/HBA controller cards: a "RAID Controller Adapter" is a
    -- storage part, correctly matched by the Storage rule below -- but bare
    -- "Adapter" here would otherwise intercept it first.
    WHEN p_name ~* '(Adptr|Adapter|BASE-T|\mNIC\M|Network Card|Ethernet)'
     AND p_name !~* '(RAID Controller|\mHBA\M)'
      THEN 'Networking'
    WHEN p_name ~* '(Main Processing Unit|\mMPU\M|\mHMIM\M|Pltfrm Mod|Fabric Mod|\mBdl\M|Bundle)' THEN 'Networking'

    WHEN p_name ~* '(GPU|Graphics Card|Quadro|RTX|GeForce|Radeon|Tesla|A100|H100|Accelerator)' THEN 'GPUs & AI Accelerators'
    WHEN p_name ~* '(Cable|Cbl|Patch Cord|Fiber Patch|Jumper|Jpr Cord|\mDAC\M|Transceiver|XCVR|SFP|QSFP|\mAOC\M|Q-DD)' THEN 'Cables & Connectivity'
    -- Excludes accessory nouns: a bag, case, privacy filter or dock that
    -- merely mentions "laptop"/"notebook" for compatibility is not itself a
    -- laptop. None of the named model lines below is a word a real
    -- accessory's own name would independently contain, so this costs
    -- nothing for genuine laptops.
    WHEN p_name ~* '(Laptop|Notebook|ProBook|EliteBook|ThinkPad|Latitude|Precision|ZBook)'
     AND p_name !~* '(\mBag\M|\mCase\M|Backpack|Sleeve|\mCover\M|\mSkin\M|Privacy Filter|Screen Filter|Screen Protector|\mCharger\M|Power Adapter|AC[- ]Adapter|Car Adapter|\mStand\M|Dock|Docking|\mLock\M|\mStrap\M|Cooling Pad|Riser Pad)'
      THEN 'Laptops'
    WHEN p_name ~* '(Desktop|Workstation|Tower|OptiPlex|MiniPC|\mNUC\M|Micro PC)' THEN 'Desktops & Workstations'
    WHEN p_name ~* '(Monitor|Display|Screen|\mLCD\M)' THEN 'Monitors & Displays'
    WHEN p_name ~* '(Keyboard|Mouse|Headset|Webcam|Docking|Dock )' THEN 'Peripherals'

    WHEN p_name ~* '([0-9]+SFF|[0-9]+LFF|CTO Shelf|Drive Shelf|Disk Shelf)' THEN 'Storage'
    WHEN p_name ~* '(Spectra|\mLib\M|Library|Drv Sled|Drive Sled|\mLTO\M|\mTS[0-9]{4}\M|Autoloader)' THEN 'Storage'
    WHEN p_name ~* '(DVD|Blu-?ray|Opt Drive|Optical Drive)' THEN 'Storage'
    WHEN p_name ~* '(Alletra|Qumulo|Nimble|Primera|StoreOnce|StoreEver|3PAR|\mMSA\M|\mArray\M)' THEN 'Storage'
    WHEN p_name ~* '(Controller|\mHBA\M|\mRAID\M|Drive Cage|Backplane|\mSFF\M|\mLFF\M|Smart Array)' THEN 'Storage'
    WHEN p_name ~* '(\mSSD\M|\mHDD\M|Hard Drive|Solid State|NVMe|Storage|\mSAN\M|\mNAS\M|Data Cartridge|LTO-)' THEN 'Storage'

    WHEN p_name ~* '(Camera|CCTV|Surveillance|IP Cam)' THEN 'Security & Surveillance'
    -- Excludes "wall mount": a server racks, it never wall-mounts, so this
    -- phrase is unambiguous evidence of the wrong bucket. Caught a dozen
    -- Aavara TV/monitor wall-mount and mounting-column products, plus two
    -- conferencing-room wall mounts, none of them server or data-centre gear.
    WHEN p_name ~* '(Server|\mSvr\M|Rack|Chassis|Blade|Rail Kit|\mRail\M|Riser|\mMt Kit\M|\mMNT\M|Mount|Bracket|Tray|Frame)'
     AND p_name !~* 'Wall[- ]Mount'
      THEN 'Servers & Data Centre'
    ELSE 'Accessories (General)'
  END;
$function$;

-- Both triggers call classify_product_category() with NEW.category as the
-- "raw category" argument. On INSERT that is genuinely the distributor's raw
-- taxonomy text; on UPDATE it is this function's own prior output being fed
-- back in, which is what let bug 1 above freeze a row's category permanently.
-- NULL on UPDATE forces every write to re-derive from the current name.
CREATE OR REPLACE FUNCTION public.products_set_category()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.category := public.classify_product_category(NEW.name, NEW.category);
  ELSE
    NEW.category := public.classify_product_category(NEW.name, NULL);
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.products_set_audience()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.category := public.classify_product_category(NEW.name, NEW.category);
  ELSE
    NEW.category := public.classify_product_category(NEW.name, NULL);
  END IF;
  -- A locked row keeps the audience a human gave it. Category is still
  -- refreshed: locking the split is not a reason to let the category rot.
  IF NOT coalesce(NEW.audience_locked, false) THEN
    NEW.audience := public.classify_product_audience(NEW.name, NEW.category, NEW.price);
  END IF;
  RETURN NEW;
END;
$function$;

-- One-time (and reusable) batched re-derivation for existing rows, mirroring
-- reclassify_audience_batch's shape. Existing rows never fire an UPDATE just
-- because this migration changed the function, so without this they would
-- sit exactly as wrong as before until their next unrelated write.
CREATE OR REPLACE FUNCTION public.reclassify_category_batch(batch_size integer DEFAULT 5000)
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
    SELECT id, name
    FROM public.products
    WHERE category IS DISTINCT FROM public.classify_product_category(name, NULL)
    LIMIT batch_size
  )
  UPDATE public.products p
     SET category = public.classify_product_category(b.name, NULL)
    FROM batch b
   WHERE p.id = b.id;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$function$;

DO $$
DECLARE
  n int;
BEGIN
  LOOP
    SELECT public.reclassify_category_batch(2000) INTO n;
    EXIT WHEN n = 0;
  END LOOP;
END $$;
