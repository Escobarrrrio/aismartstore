-- Follow-up to 20260906230000: verifying that migration's own fix turned up
-- two more accessory nouns the exclusion list didn't cover yet, both
-- confirmed live -- one of them (the mouse) active and publicly visible on
-- the Laptops page right now:
--
--   "Microsoft Notebook Optical Wired Mouse Silver" -- "Notebook" here is a
--   form-factor descriptor for a compact mouse, the same way "Notebook"
--   appears on countless mice/keyboards marketed for laptop use. Would have
--   been caught by the existing Peripherals "Mouse" rule further down the
--   CASE, but the Laptops rule sits earlier and matches "Notebook" first.
--
--   "Aavara ANT01 Notebook Tray" -- a laptop tray/stand accessory, the exact
--   same shape of false positive as the Bag/Case/Stand exclusions already in
--   the list, just a noun ("Tray") that list didn't happen to include yet.
--
-- Not chased further: "APACER ADM 2GB 44pin Notebook" and "Apacer ADM 4GB
-- 44pin -Notebook" (both inactive, so not customer-visible). "44-pin" is the
-- connector on a 2.5" notebook-form-factor IDE hard drive, which would make
-- these Storage rather than Laptops -- but that reading rests on inferring
-- what "44pin" means rather than on a word this function can safely match
-- without risking the same kind of wrong-but-confident guess this whole
-- effort exists to remove. Left unmatched, same as every other genuinely
-- ambiguous case already in this function.
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

    WHEN p_name ~* '(\mUPS\M|\mPDU\M|Uninterruptible|\mPSU\M|Power Supply|Power Adapter|AC[- ]Adapter|Car Adapter|Car Charger|Pwr Crd|Pwr Cord|Power Cord|Pwr2Prt|Power Shelf|Redundant Power|\mRPS[0-9]|\mERM\M|Battery Module|Batt Module|C1[3-9]/C[12][0-9])' THEN 'Power & Cooling'
    WHEN p_name ~* '(\mFan\M|Fan Kit|Heatsink|Heat Sink|Cooling)' THEN 'Power & Cooling'

    WHEN p_name ~* '(SVC$|\mFC[0-9]Y\M|NBDExch|NBD Exch|Foundation Care|Care Pack|Proactive Care|Tech Care|Warranty Extension|Extended Warranty|Warranty Upgrade|Warr\.|Support Service|Deinstallation|Installation Service|Startup Service|Service$)' THEN 'Support & Warranty'
    WHEN p_name ~* '(License|Licence|Subscription|SaaS|E-LTU|LTU\M|Lic Kit|\mLic\M|Monthly Payment|Per User|Office 365|Microsoft 365|Azure|Windows Server|Veeam|Kasten|Commvault|Veritas|Acronis|Rubrik)' THEN 'Software & Licensing'

    WHEN p_name ~* '(\mXeon\M|\mEPYC\M|\mCPU\M|Processor|Threadripper|\mRyzen\M|Core i[3579])' THEN 'Processors'

    WHEN p_name ~* '(Toner|Ink Cart|Cartridge|Drum|Fuser)' THEN 'Printer Consumables'
    WHEN p_name ~* '(Printer|MFP|Multifunction|Scanner)' THEN 'Printers & Scanners'

    WHEN p_name ~* '(\mSwch\M|\mSwtch\M|Switch|Router|Firewall|Access Point|\mAP-|\mWAP\M|WiFi|Wi-Fi|Wireless|Antenna|\mANT-|\mdBi\M|SD-WAN|Gateway|Battery Beacon|Battery Tag|LTE Modem|\mModem\M|Beacon)' THEN 'Networking'
    WHEN p_name ~* '(Adptr|Adapter|BASE-T|\mNIC\M|Network Card|Ethernet)'
     AND p_name !~* '(RAID Controller|\mHBA\M)'
      THEN 'Networking'
    WHEN p_name ~* '(Main Processing Unit|\mMPU\M|\mHMIM\M|Pltfrm Mod|Fabric Mod|\mBdl\M|Bundle)' THEN 'Networking'

    WHEN p_name ~* '(GPU|Graphics Card|Quadro|RTX|GeForce|Radeon|Tesla|A100|H100|Accelerator)' THEN 'GPUs & AI Accelerators'
    WHEN p_name ~* '(Cable|Cbl|Patch Cord|Fiber Patch|Jumper|Jpr Cord|\mDAC\M|Transceiver|XCVR|SFP|QSFP|\mAOC\M|Q-DD)' THEN 'Cables & Connectivity'
    -- Added \mMouse\M and \mTray\M: "Notebook Mouse"/"Notebook Tray" are
    -- accessory nouns exactly like Bag/Case/Stand below, just two this list
    -- didn't have yet -- confirmed live in the previous migration's own
    -- verification pass, one of them (the mouse) active and customer-facing.
    WHEN p_name ~* '(Laptop|Notebook|ProBook|EliteBook|ThinkPad|Latitude|Precision|ZBook)'
     AND p_name !~* '(\mBag\M|\mCase\M|Backpack|Sleeve|\mCover\M|\mSkin\M|Privacy Filter|Screen Filter|Screen Protector|\mCharger\M|Power Adapter|AC[- ]Adapter|Car Adapter|\mStand\M|Dock|Docking|\mLock\M|\mStrap\M|Cooling Pad|Riser Pad|\mMouse\M|\mTray\M)'
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
    WHEN p_name ~* '(Server|\mSvr\M|Rack|Chassis|Blade|Rail Kit|\mRail\M|Riser|\mMt Kit\M|\mMNT\M|Mount|Bracket|Tray|Frame)'
     AND p_name !~* 'Wall[- ]Mount'
      THEN 'Servers & Data Centre'
    ELSE 'Accessories (General)'
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
