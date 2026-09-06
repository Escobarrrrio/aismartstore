-- classify_product_audience() hardcoded 'Laptops' and 'Desktops & Workstations'
-- into the always-residential category list this morning, to fix a real
-- problem: a R26k consumer laptop was being pushed to the business catalogue
-- purely for being expensive. The fix overcorrected -- it made it structurally
-- impossible for ANY laptop or desktop to ever be classified business,
-- regardless of what it actually is. Live result: all 15 active Laptops sit
-- at audience='residential', zero at 'business', so the Business Portal
-- (registered government/enterprise buyers) shows "0 products" for a category
-- that is one of the most routine enterprise procurement lines there is --
-- reported directly by the owner, a reseller whose own compliance profile
-- markets government/enterprise laptop supply as a core offering.
--
-- The fix is the same shape as the rest of this function: real, confirmed
-- model-line names at any price, not a price threshold, and nothing guessed.
-- Read all 71 rows in the Laptops category (not just the 15 active ones)
-- before writing this -- confirmed by name, not assumed:
--
--   business : "Dell Latitude 5330 ... W11Pro ... 3Y ProSpt"        (fleet/IT)
--              "WT72-6QM-458 Xeon+M5000+32E+s"                      (MSI WT =
--                 their workstation line; Xeon + a workstation-class GPU
--                 code is not a spec combination any consumer laptop ships)
--              "HP Workstation Accessories HP Z640/Z840/Z8G4 Rail Rack Kit"
--              "Kit-OptiPlex Micro and Thin Client ..."             (Dell's
--                 dedicated business desktop line, distinct from consumer
--                 Inspiron/XPS)
--   residential (left alone): ASUS Vivobook (X15xx/X5xx/E15xx/TN34xx),
--              ASUS ZenBook (UX-series), ASUS ROG/TUF gaming (G6xx/G8xx/
--              GT/GU/FX/FA), Lenovo IdeaPad, Dell Inspiron
--
-- Deliberately NOT matched: cryptic ASUS "B7402"/"B9400"/"P1503"-style codes
-- that plausibly are ExpertBook (ASUS's business line) but never spell out
-- the name in this feed. Guessing at an alphanumeric prefix here risks the
-- exact class of misclassification this migration exists to fix, in the
-- direction that actually matters more: hiding a genuinely enterprise item
-- from the audience that already can browse it either way is a smaller harm
-- than a false "business" match, so these stay residential by the same
-- price-tiebreaker path as before, unmatched, rather than a guess.
--
-- The HP workstation check requires "HP" AND a Z-model-code as two separate
-- conditions, not one combined pattern: a bare \mZ[2468]\d{2,3}\M alone
-- matched "Logitech ... Z207 Bluetooth Computer Speakers" in a dry run --
-- Logitech's own Z-prefixed speaker numbering collides with HP's workstation
-- one. Confirmed against every live Laptops/Desktops row before landing this,
-- specifically to catch this kind of coincidence rather than assume it away.
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
    WHEN p_category IN ('Servers & Data Centre', 'Software & Licensing', 'Support & Warranty')
      THEN 'business'

    WHEN p_name ~* '(ProLiant|Synergy|Superdome|BladeSystem|Apollo|Alletra|Nimble|3PAR|Primera|StoreOnce|StoreEver|\mMSA\M)'
      OR p_name ~* '(RHEL|Red Hat|VMware|vSphere|vCenter|Nutanix|Citrix|Hyper-V|Windows Server|\mCAL\M|Datacenter|Datacentre)'
      OR p_name ~* '(E-LTU|\mLTU\M|Care Pack|Foundation Care|Proactive Care|Tech Care|\mNBD\M|NBDExch)'
      OR p_name ~* '(Rackmount|Rack Mount|\mRack\M|Chassis|BladeSystem|Blade Server|\mBL[0-9]{3}|Riser|Rail Kit|\mPDU\M|\mUPS\M|\mKVM\M|\m[1-9]U\M)'
      OR p_name ~* '(\mSFP\M|QSFP|Transceiver|\mXCVR\M|\mDAC\M|Fibre Channel|Fiber Channel|InfiniBand|Multi-mode|Multimode|\mOM[34]\M|LC/LC)'
      OR p_name ~* '(\mLTO\M|Autoloader|\mJBOD\M|\mSAN\M|Smart Array|Tape Drive|Tape Library)'
      OR p_name ~* '(Aruba|ClearPass|FlexNetwork|FlexFabric|\mIMC\M|\mMSR[0-9])'
      OR p_name ~* '(RDIMM|LRDIMM|\mECC\M|Registered DIMM)'
      OR p_name ~* '(Enterprise|\mServer\M|\mSvr\M)'
      THEN 'business'

    -- Named enterprise laptop/desktop lines, at any price -- the same
    -- "being cheap is not evidence it's consumer, being a laptop is not
    -- evidence it's consumer either" principle as the block above.
    WHEN p_category IN ('Laptops', 'Desktops & Workstations')
     AND p_name ~* '(Latitude|Precision|ThinkPad|ThinkCentre|EliteBook|ProBook|\mZBook\M|OptiPlex)'
      THEN 'business'
    -- HP's Z-series workstations (Z2/Z4/Z6/Z8, "Z640"/"Z840"/"Z8G4" etc.):
    -- "HP" and the Z-code are checked as two separate conditions, not one
    -- pattern -- a bare Z-code alone also matches Logitech's own Z-prefixed
    -- speaker model numbers ("Z207", "Z313"), confirmed in a dry run before
    -- this landed.
    WHEN p_category IN ('Laptops', 'Desktops & Workstations')
     AND p_name ~* '\mHP\M' AND p_name ~* '\mZ[2468]\d{2,3}\M'
      THEN 'business'
    -- Xeon in a laptop/desktop name: no consumer machine ships one. Scoped to
    -- these two categories so it can't reach for e.g. a bare CPU listing,
    -- which the Processors category (and the block above) already own.
    WHEN p_category IN ('Laptops', 'Desktops & Workstations') AND p_name ~* '\mXeon\M'
      THEN 'business'

    -- Categories a household shopper genuinely buys from -- Laptops and
    -- Desktops & Workstations stay here for everything the two rules above
    -- did not already claim.
    WHEN p_category IN ('Peripherals', 'Printer Consumables', 'Printers & Scanners',
                        'Monitors & Displays', 'Laptops', 'Desktops & Workstations',
                        'Security & Surveillance', 'Flash Drives', 'External Hard Drives')
      THEN 'residential'

    WHEN coalesce(p_price, 0) <= 15000 THEN 'residential'
    ELSE 'business'
  END;
$function$;

-- Re-derive every row against the corrected function.
SELECT public.reclassify_audience_batch(10000);
