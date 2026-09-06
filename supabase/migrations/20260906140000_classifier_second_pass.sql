-- Second classification pass over what the first one left behind.
--
-- After the first pass 317 active products were still in 'Accessories
-- (General)'. Reading them rather than assuming they were miscellany showed
-- most were not:
--
--   "HPE 16GB 2Rx8 PC4-2666V-R Smart Kit"      -- memory, but HPE writes the
--                                                 spec as PC4-2666V with no
--                                                 literal "DDR" to match
--   "HPE DL345 Gen11 8SFF x4 TM BC Mid Kit"    -- \mSFF\M could never match
--                                                 "8SFF": the digit joins the
--                                                 word, so the boundary fails
--   "HPE SN6650B 4x32Gb 32p SW FC Upg Lic Kit" -- licensing, abbreviated
--   "HPE R/T2200 ERM"                          -- UPS external runtime module
--   "Aruba LS-BT20-50 4yr Battery Beacon 50pk" -- IoT beacons
--
-- This pass adds those patterns. 174 remain afterwards, and those are
-- genuinely assorted -- forcing them further would be fitting rules to
-- individual SKUs rather than classifying.
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

    WHEN p_name ~* '(MX Anywhere|MX Master|MX Keys|Unifying|MeetUp|Rally|Zone Wired|Zone Vibe|Litra|StreamCam|\mBrio\M|Ergo K|Pebble|Signature|Desk Mat|Mouse Pad|Mousepad|Palm Rest|Wrist Rest)' THEN 'Peripherals'

    -- Memory before anything that could swallow a "... Kit": HPE writes the
    -- spec as "16GB 2Rx8 PC4-2666V-R Smart Kit".
    WHEN p_name ~* '(PC[0-9]-[0-9]{4}|[0-9]+GB [0-9]Rx[0-9]|[0-9]+GB.*(Smart Kit|Smrt Kit))' THEN 'Memory'
    WHEN p_name ~* '(\mRAM\M|Memory|DIMM|SODIMM|\mDDR)' THEN 'Memory'

    -- Power. C13/C19-style connector notation identifies a power cord far
    -- more safely than matching a trailing "PC", which would also catch
    -- actual computers.
    WHEN p_name ~* '(\mUPS\M|\mPDU\M|Uninterruptible|\mPSU\M|Power Supply|Pwr Crd|Pwr Cord|Power Cord|Pwr2Prt|Power Shelf|Redundant Power|\mRPS[0-9]|\mERM\M|Battery Module|Batt Module|C1[3-9]/C[12][0-9])' THEN 'Power & Cooling'
    WHEN p_name ~* '(\mFan\M|Fan Kit|Heatsink|Heat Sink|Cooling)' THEN 'Power & Cooling'

    WHEN p_name ~* '(SVC$|\mFC[0-9]Y\M|NBDExch|NBD Exch|Foundation Care|Care Pack|Proactive Care|Tech Care|Warranty Extension|Extended Warranty|Warranty Upgrade|Warr\.|Support Service|Deinstallation|Installation Service|Startup Service|Service$)' THEN 'Support & Warranty'
    WHEN p_name ~* '(License|Licence|Subscription|SaaS|E-LTU|LTU\M|Lic Kit|\mLic\M|Monthly Payment|Per User|Office 365|Microsoft 365|Azure|Windows Server|Veeam|Kasten|Commvault|Veritas|Acronis|Rubrik)' THEN 'Software & Licensing'

    WHEN p_name ~* '(\mXeon\M|\mEPYC\M|\mCPU\M|Processor|Threadripper|\mRyzen\M|Core i[3579])' THEN 'Processors'

    WHEN p_name ~* '(Toner|Ink Cart|Cartridge|Drum|Fuser)' THEN 'Printer Consumables'
    WHEN p_name ~* '(Printer|MFP|Multifunction|Scanner)' THEN 'Printers & Scanners'

    WHEN p_name ~* '(\mSwch\M|\mSwtch\M|Switch|Router|Firewall|Access Point|\mAP-|\mWAP\M|WiFi|Wi-Fi|Wireless|Antenna|\mANT-|\mdBi\M|SD-WAN|Gateway|Battery Beacon|Battery Tag|LTE Modem|\mModem\M|Beacon)' THEN 'Networking'
    WHEN p_name ~* '(Adptr|Adapter|BASE-T|\mNIC\M|Network Card|Ethernet)' THEN 'Networking'
    WHEN p_name ~* '(Main Processing Unit|\mMPU\M|\mHMIM\M|Pltfrm Mod|Fabric Mod|\mBdl\M|Bundle)' THEN 'Networking'

    WHEN p_name ~* '(GPU|Graphics Card|Quadro|RTX|GeForce|Radeon|Tesla|A100|H100|Accelerator)' THEN 'GPUs & AI Accelerators'
    WHEN p_name ~* '(Cable|Cbl|Patch Cord|Fiber Patch|Jumper|Jpr Cord|\mDAC\M|Transceiver|XCVR|SFP|QSFP|\mAOC\M|Q-DD)' THEN 'Cables & Connectivity'
    WHEN p_name ~* '(Laptop|Notebook|ProBook|EliteBook|ThinkPad|Latitude|Precision|ZBook)' THEN 'Laptops'
    WHEN p_name ~* '(Desktop|Workstation|Tower|OptiPlex|MiniPC|\mNUC\M|Micro PC)' THEN 'Desktops & Workstations'
    WHEN p_name ~* '(Monitor|Display|Screen|\mLCD\M)' THEN 'Monitors & Displays'
    WHEN p_name ~* '(Keyboard|Mouse|Headset|Webcam|Docking|Dock )' THEN 'Peripherals'

    -- "8SFF"/"2LFF" need the digit-tolerant form; the \m boundary version
    -- only ever matched a bare "SFF".
    WHEN p_name ~* '([0-9]+SFF|[0-9]+LFF|CTO Shelf|Drive Shelf|Disk Shelf)' THEN 'Storage'
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

-- Re-derive the generic bucket again with the wider vocabulary.
UPDATE public.products
   SET category = public.classify_product_category(name, NULL)
 WHERE is_active = true
   AND (category IS NULL OR btrim(category) = ''
        OR lower(btrim(category)) IN ('accessories', 'accessories (general)'));

SELECT public.reclassify_audience_batch(10000);

ANALYZE public.products;
