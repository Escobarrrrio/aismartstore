-- Found while verifying the previous two migrations: removing the freeze bug
-- (20260906230000) let this row re-derive for the first time in who knows
-- how long, and it moved somewhere worse. The Processors rule's bare
-- 'Core i[3579]'/'Xeon' match sits earlier in the CASE than Laptops/Desktops,
-- so any listing that puts its own CPU spec in the product name -- which is
-- standard distributor practice for a full machine, not just chips -- gets
-- claimed by Processors before Laptops ever gets a look. Confirmed live: the
-- Dell Latitude 5330 (the one active, customer-visible Business Portal
-- laptop landed by migration 20260906220000 this session) name-checks its
-- own "Core i5 1235U", and had just flipped from Laptops to Processors as a
-- direct result of un-freezing it.
--
-- Fixed by excluding genuine computer model-line brand names from the
-- Processors match -- Latitude/ThinkPad/EliteBook/ProBook/ZBook/Precision/
-- OptiPlex/NUC/MiniPC are exclusively Dell/HP/Lenovo/Intel machine lines; no
-- CPU-cooler or chip listing would ever carry one. Deliberately NOT bare
-- "Laptop"/"Desktop"/"Tower"/"Notebook" here (unlike the Laptops rule's own
-- exclusion list) -- three live DeepCool "Dual Tower CPU Air Cooler" listings
-- also match the Processors rule and legitimately belong there; excluding on
-- "Tower" would misfile a cooler as a whole computer.
--
-- Known gap, deliberately left: two MSI "WT72" mobile workstations (Xeon +
-- workstation-class GPU) also flipped to Processors, via bare Xeon rather
-- than Core i[3579]. Their FR-NB- SKU prefix is Frontosa's own notebook
-- marker (confirmed against many other FR-NB- rows resolved during today's
-- work), so they are laptops -- but "WT72" is MSI's own model code, not a
-- brand-line word this function can safely generalize from without risking
-- a wrong-but-confident match elsewhere. Both are currently inactive
-- (awaiting photos), so not customer-visible; left unmatched rather than
-- guessed, same as every other genuinely ambiguous case in this function.
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

    -- Excludes genuine computer model-line names: a full laptop/desktop that
    -- lists its own CPU spec (standard distributor naming) is not a bare
    -- chip. Deliberately narrow -- no bare Laptop/Desktop/Tower/Notebook
    -- here, since legitimate CPU-cooler listings ("Dual Tower CPU Air
    -- Cooler") also say "Tower" and must still land here.
    WHEN p_name ~* '(\mXeon\M|\mEPYC\M|\mCPU\M|Processor|Threadripper|\mRyzen\M|Core i[3579])'
     AND p_name !~* '(Latitude|ThinkPad|EliteBook|ProBook|\mZBook\M|Precision|OptiPlex|\mNUC\M|MiniPC)'
      THEN 'Processors'

    WHEN p_name ~* '(Toner|Ink Cart|Cartridge|Drum|Fuser)' THEN 'Printer Consumables'
    WHEN p_name ~* '(Printer|MFP|Multifunction|Scanner)' THEN 'Printers & Scanners'

    WHEN p_name ~* '(\mSwch\M|\mSwtch\M|Switch|Router|Firewall|Access Point|\mAP-|\mWAP\M|WiFi|Wi-Fi|Wireless|Antenna|\mANT-|\mdBi\M|SD-WAN|Gateway|Battery Beacon|Battery Tag|LTE Modem|\mModem\M|Beacon)' THEN 'Networking'
    WHEN p_name ~* '(Adptr|Adapter|BASE-T|\mNIC\M|Network Card|Ethernet)'
     AND p_name !~* '(RAID Controller|\mHBA\M)'
      THEN 'Networking'
    WHEN p_name ~* '(Main Processing Unit|\mMPU\M|\mHMIM\M|Pltfrm Mod|Fabric Mod|\mBdl\M|Bundle)' THEN 'Networking'

    WHEN p_name ~* '(GPU|Graphics Card|Quadro|RTX|GeForce|Radeon|Tesla|A100|H100|Accelerator)' THEN 'GPUs & AI Accelerators'
    WHEN p_name ~* '(Cable|Cbl|Patch Cord|Fiber Patch|Jumper|Jpr Cord|\mDAC\M|Transceiver|XCVR|SFP|QSFP|\mAOC\M|Q-DD)' THEN 'Cables & Connectivity'
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
