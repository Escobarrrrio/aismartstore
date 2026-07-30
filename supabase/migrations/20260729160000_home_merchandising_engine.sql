-- ===========================================================================
-- Home-page merchandising engine
-- ===========================================================================
--
-- WHAT WAS WRONG
-- --------------
-- The residential home page picked its products with `ORDER BY created_at
-- DESC`, i.e. by whatever the Axiz feed happened to push most recently.
-- Against the real residential pool that is indistinguishable from random,
-- and the pool is dominated by exactly what a household shopper never wants:
--
--     Cables & Connectivity      313  \  together 57% of the whole
--     Accessories (General)      308  /  residential catalogue
--     Support & Warranty         132     <- a 3-year care pack is not a product
--     Servers & Data Centre       92     <- not residential in any sense
--     Storage                     69
--     Peripherals                 52
--     ...
--     Smart Home                   4
--     Laptops                      3
--     Wearables                    1
--     Health & Wellness            1
--
-- and only ~160 of 1 084 residential products are actually in stock. Date
-- ordering therefore produced a shop window of rack rails, C13 power cords and
-- QSFP transceivers, most of them unbuyable. That is not a styling problem, it
-- is the single largest conversion problem the storefront has.
--
-- WHAT THIS IS
-- ------------
-- A deterministic, explainable scoring engine. Every candidate product is
-- scored 0-100 from seven independently testable factors:
--
--     demand        what a South African household actually shops for
--     brand         consumer brand recognition
--     price         where online conversion actually happens
--     name          is the title readable by a human, or is it a part number
--     availability  can it be bought today
--     media         is there a real photograph, and more than one angle
--     signal        real paid orders + wishlist saves (see below)
--
-- It is SQL, not an LLM call. That is deliberate: it has to run on a cron in
-- milliseconds, give the same answer twice, be unit-testable, and be incapable
-- of inventing a product that does not exist.
--
-- The *weights* live in store_settings (`merch.weight.*`), so the shop owner
-- can re-tune the mix with one UPDATE and no deploy. The *knowledge* -- which
-- categories, brands and keywords sell -- lives here in code, where it is
-- reviewed, diffed and version controlled.
--
-- WHY THE ENGINE CANNOT BREAK THE HOME PAGE
-- -----------------------------------------
--  1. Hard eligibility gates (merch_is_home_eligible) are invariants, not
--     weights. No amount of weight tuning can put a rack server, a warranty
--     line or an imageless product on the home page.
--  2. refresh_home_showcase() rewrites its own table in a single transaction,
--     and refuses to write at all if the candidate set is empty -- so a broken
--     supplier sync degrades to "yesterday's showcase", never to a blank page.
--  3. A unique index on home_showcase(product_id) makes the same product
--     appearing in two grids structurally impossible.
--  4. get_home_showcase() re-checks is_active at read time, so a product
--     deactivated between refreshes disappears immediately instead of linking
--     to a dead page.
--  5. If the showcase is empty for any reason the front end falls back to its
--     previous queries, so the page always renders.
--
-- ABOUT THE `signal` FACTOR
-- -------------------------
-- There are currently 0 paid orders and 1 wishlist save in the database, so
-- this factor contributes nothing today -- which is correct, and is why the
-- other six factors carry marketing priors instead. As real orders accumulate
-- the signal term rises on its own and starts overriding the priors, without
-- anybody changing code. That is the intended lifecycle: launch on judgement,
-- converge on evidence.
--
-- To revert: SELECT cron.unschedule('refresh-home-showcase');
--            DROP TABLE public.home_showcase; DROP FUNCTION ... (see bottom)
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 0. Small shared helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.merch_norm(p_text text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(lower(coalesce(p_text, '')), '\s+', ' ', 'g');
$$;
COMMENT ON FUNCTION public.merch_norm(text) IS
  'Lower-cases and collapses whitespace so keyword rules match regardless of how the supplier feed formatted a title.';

-- Reads a tunable weight/threshold out of store_settings, falling back to the
-- documented default. Anything unparseable is treated as absent rather than as
-- an error: a typo in the admin UI must not be able to stop the cron.
CREATE OR REPLACE FUNCTION public.merch_setting(p_key text, p_default numeric)
RETURNS numeric LANGUAGE plpgsql STABLE
SET search_path = public AS $$
DECLARE v text;
BEGIN
  SELECT value INTO v FROM public.store_settings WHERE key = p_key;
  IF v IS NULL OR btrim(v) = '' THEN RETURN p_default; END IF;
  RETURN btrim(v)::numeric;
EXCEPTION WHEN others THEN
  RETURN p_default;
END $$;
COMMENT ON FUNCTION public.merch_setting(text, numeric) IS
  'Tunable merchandising dial from store_settings, with a safe default. Never raises.';


-- ---------------------------------------------------------------------------
-- 1. DEMAND -- what a South African household actually shops for
-- ---------------------------------------------------------------------------
-- Two layers, because the category alone is not enough. "Accessories
-- (General)" contains both `Dell Pro 14-16 EcoLoop Slim Backpack` (a genuine
-- consumer purchase) and `HPE MicroSvr Gen10 NHP Converter Kit` (not), with
-- identical category, brand-family and price band. The demand signal for a
-- consumer lives in the product title, so:
--
--   layer 1  a prior per canonical category
--   layer 2  keyword lifts for real consumer product types, then keyword
--            floors that crush enterprise spares, transceivers, licences and
--            service contracts no matter what category they were filed under
--
-- Layer 2's floors are applied last on purpose: a "Smart rack PDU" must not
-- reach the home page just because it says "smart".
CREATE OR REPLACE FUNCTION public.merch_demand_tier(
  p_category text,
  p_name     text,
  p_is_ai    boolean DEFAULT false
) RETURNS numeric LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  n    text    := public.merch_norm(p_name);
  cat  text    := coalesce(p_category, '');
  base numeric;
BEGIN
  -- Layer 1: category priors. Ordered by how much everyday consumer search
  -- volume the category carries in South Africa, not by margin or stock depth.
  base := CASE cat
    WHEN 'Laptops'                 THEN 100   -- perennially the #1 consumer tech search
    WHEN 'Smart Home'              THEN  96   -- fastest-growing consumer category, on-brand
    WHEN 'Wearables'               THEN  92
    WHEN 'Peripherals'             THEN  90   -- mice/keyboards/webcams/headsets: high volume, easy yes
    WHEN 'Monitors & Displays'     THEN  86
    WHEN 'Health & Wellness'       THEN  84
    WHEN 'Storage'                 THEN  78   -- external drives and SSDs, a classic self-serve buy
    WHEN 'GPUs & AI Accelerators'  THEN  74   -- gamers and AI hobbyists search this hard
    WHEN 'Desktops & Workstations' THEN  72
    WHEN 'Networking'              THEN  68   -- routers/mesh/LTE: bought on need, not on browse
    WHEN 'Memory'                  THEN  54   -- an upgrade part; buyers arrive knowing the SKU
    WHEN 'Printer Consumables'     THEN  44   -- repeat purchase, but nobody browses for toner
    WHEN 'Software & Licensing'    THEN  38
    WHEN 'Accessories (General)'   THEN  34   -- huge and wildly mixed; layer 2 does the real work
    WHEN 'Cables & Connectivity'   THEN  22
    WHEN 'Servers & Data Centre'   THEN   4
    WHEN 'Support & Warranty'      THEN   0   -- a care pack is a line item, not a shop window
    ELSE 40                                   -- unknown category: neutral, never punished
  END;

  -- Layer 2a: consumer product-type lifts, most specific first.
  IF n ~ '\y(robot vacuum|air purifier|air fryer|doorbell|thermostat|light strip|smart bulb|smart light|smart plug|smart lock|smart camera|smart speaker|smart remote|smart scale|hub mini)\y' THEN
    base := greatest(base, 96);
  ELSIF n ~ '\y(laptop|notebook|macbook|chromebook|ultrabook)\y'
     AND n !~ '\y(bag|case|sleeve|backpack|briefcase|stand|riser|dock|docking|charger|adapter|adaptor|battery|lock|screen protector)\y' THEN
    base := greatest(base, 98);
  ELSIF n ~ '\y(smart ?watch|fitness tracker|smart ring|body analy[sz]er|activity tracker)\y' THEN
    base := greatest(base, 92);
  ELSIF n ~ '\y(webcam|web cam|conference cam)\y' THEN
    base := greatest(base, 90);
  ELSIF n ~ '\y(headset|headphone|earbud|earphone|soundbar)\y' THEN
    base := greatest(base, 88);
  ELSIF n ~ '\y(gaming|alienware)\y' AND n ~ '\y(mouse|keyboard|headset|monitor|chair)\y' THEN
    base := greatest(base, 88);
  ELSIF n ~ '\y(monitor|display)\y' AND n ~ '\y(1?[2-4][0-9]("|inch| in)|fhd|qhd|uhd|4k|curved)\y' THEN
    base := greatest(base, 86);
  ELSIF n ~ '\y(mouse|keyboard|trackpad|keypad|stylus|active pen|graphics tablet)\y' THEN
    base := greatest(base, 82);
  ELSIF n ~ '\y(backpack|briefcase|laptop bag|sleeve|carry case|power ?bank|docking station|usb hub|card reader)\y' THEN
    base := greatest(base, 76);
  ELSIF n ~ '\y(ssd|nvme|external (drive|hdd|ssd)|flash drive|memory card|micro ?sd|portable drive)\y' THEN
    base := greatest(base, 78);
  ELSIF n ~ '\y(router|mesh|wi-?fi ?6|wifi ?6|access point|lte|5g router)\y' THEN
    base := greatest(base, 72);
  ELSIF cat = 'Cables & Connectivity' AND n ~ '\y(hdmi|usb-?c|displayport|thunderbolt|lightning)\y' THEN
    -- The only cables a consumer ever deliberately shops for.
    base := greatest(base, 45);
  END IF;

  -- Layer 2b: accessory demotion. A laptop charger is not a laptop. The
  -- category prior fires on whatever the supplier filed the product under, so
  -- "Dell Laptop Car and Airplane 65W DC Power Adapter", categorised Laptops,
  -- inherited the highest prior in the catalogue and came out ranked #1 on the
  -- first dry run. Demote by what the title actually is, not by where it was
  -- filed. These are real products worth selling -- they just must not headline
  -- the slot belonging to the device they plug into.
  IF n ~ '\y(power adapter|ac adapter|dc adapter|charger|charging cable|battery|screen protector|privacy (filter|screen)|cable lock|combination lock|nano lock|security lock|kensington lock)\y' THEN
    base := least(base, 58);
  ELSIF n ~ '\y(bag|case|sleeve|backpack|briefcase|stand|riser|arm|mount|dock|docking)\y' THEN
    base := least(base, 76);
  END IF;

  -- Internal upgrade modules. "HP XMM 7360 LTE Advance WWAN" was lifted to 72
  -- by the router/LTE rule, but it is a card that goes inside a laptop, not
  -- something a household shops for. Real product, wrong shop window.
  IF n ~ '\y(wwan|wlan|m\.?2 (card|module)|combo card|wireless card|antenna)\y' THEN
    base := least(base, 45);
  END IF;

  -- Layer 2c: hard floors. These win over every lift above.
  --
  -- Enterprise spares, optics and fabric parts. Real examples from this
  -- catalogue that used to reach the home page: "HPE 100Gb QSFP28 SR4 100m
  -- XCVR", "HPE DL380 Gen10 2U Rail Kit", "HPE MicroSvr Gen10 NHP Converter
  -- Kit".
  IF n ~ '\y(xcvr|transceiver|qsfp|sfp|dac|aoc|hba|jbod|backplane|riser|bezel|blade|chassis|rail kit|rackmount|rack mount|1u|2u|3u|4u|dimm|rdimm|udimm|lrdimm|smart array|raid controller|ilo|proliant|synergy|nimble|alletra|apollo|superdome|nhp|hot ?plug|heatsink|fan module|fan kit|converter kit|spare|fru|assembly|drive tray|drive cage|power supply|psu|pdu|ups module)\y' THEN
    base := least(base, 3);
  END IF;

  -- Server model designations. "HPE DL360 Gen10 2P FH GPU Enable v2 Kit" is
  -- categorised GPUs & AI Accelerators and flagged is_ai_product, so it scored
  -- 80 and reached the shop window on the second dry run. It is a bracket that
  -- lets you bolt a GPU into a rack server. The model prefixes below (DL360,
  -- ML110, XL290n, Gen10/Gen11) are unambiguous enterprise-line markers.
  IF n ~ '\y(dl[0-9]{3}|ml[0-9]{2,3}|xl[0-9]{2,3}[a-z]?|bl[0-9]{3}|sy[0-9]{3}|gen[0-9]{1,2}\+?|microsvr|micro ?server|edgeline|enable(ment)? kit|gpu enable)\y' THEN
    base := least(base, 3);
  END IF;

  -- Anything that lives in a rack. "HP Workstation Accessories Z8 Rack Rail
  -- Upgrade Kit" was wrongly flagged is_ai_product by the old keyword tagger
  -- and came second in the AI Picks grid on the third dry run -- the previous
  -- floor only matched the exact phrase "rail kit". Bare `rack` and `rail` are
  -- safe: no household product title contains either.
  IF n ~ '\y(rack|rail)\y' THEN
    base := least(base, 3);
  END IF;

  -- Enterprise storage. "Dell 2TB 7.2K RPM NLSAS 12Gbps 512n 3.5in Cabled hard
  -- drive" is filed under Storage next to consumer SSDs, but it is a server
  -- drive that needs a hot-swap carrier and a RAID controller to be of any use.
  -- These interface and enclosure markers never appear on retail storage.
  IF n ~ '\y(nlsas|sas|scsi|12gbps|6gbps|hyb carr|hybrid carrier|customer kit|ise|512n|512e|hot ?swap|7\.2k|10k|15k)\y' THEN
    base := least(base, 3);
  END IF;

  -- Datacentre GPU fabric.
  IF n ~ '\y(nvlink|sxm[0-9]?|hgx|dgx|infiniband|omni-?path)\y' THEN
    base := least(base, 3);
  END IF;

  -- Service contracts, licences and renewals. 132 residential products are
  -- care packs; not one of them belongs in a shop window.
  IF n ~ '\y(warranty|care ?pack|foundation care|proactive care|datacenter care|tech(nical)? support|support service|next business day|nbd|onsite|on-site|licen[cs]e|licen[cs]ing|subscription|renewal|maintenance|e-?ltu|ltu|cal|user cal|device cal|seat)\y' THEN
    base := least(base, 2);
  END IF;

  -- Bulk cabling and power leads.
  IF n ~ '\y(power cord|jumper cord|patch cord|patch cable|patch panel|c13|c14|c19|c20|fibre patch|fiber patch|keystone|cable manager|cable tie)\y' THEN
    base := least(base, 4);
  END IF;

  -- Being AI-tagged earns a nudge, never a veto over demand reality. Treating
  -- the AI flag as dominant is precisely how R900k inference servers ended up
  -- filling the household "AI Picks" grid.
  IF coalesce(p_is_ai, false) THEN
    base := least(100, base + 6);
  END IF;

  RETURN greatest(0, least(100, base));
END $$;
COMMENT ON FUNCTION public.merch_demand_tier(text, text, boolean) IS
  'Consumer demand prior 0-100: category prior, then title-keyword lifts, then hard floors for enterprise spares, service contracts and bulk cabling.';


-- ---------------------------------------------------------------------------
-- 2. BRAND -- consumer recognition, not distributor importance
-- ---------------------------------------------------------------------------
-- The critical distinction in this catalogue: HPE (831 of 1 084 residential
-- products) is an enterprise brand a household shopper has never heard of,
-- while HPIC (HP Inc) and Dell are household names selling the same feed. An
-- unrecognised brand scores neutral rather than badly -- refusing to show a
-- good product merely because it is absent from a hand-written list would be a
-- worse failure than showing it.
CREATE OR REPLACE FUNCTION public.merch_brand_trust(p_brand text)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE b text := public.merch_norm(p_brand);
BEGIN
  IF b = '' THEN
    RETURN 40;  -- no brand at all reads as generic/grey import to a shopper
  END IF;

  -- Tier 1: household names. A shopper recognises these without explanation.
  IF b ~ '^(apple|samsung|sony|lg|logitech|logitech g|jbl|bose|anker|philips|dyson|xiaomi|google|microsoft|garmin|fitbit|canon|epson|brother|hisense|tcl|huawei|tp-?link|netgear|asus|lenovo|acer|hp|hpic|hp inc|dell|dell e|razer|corsair|nvidia|amd|intel|seagate|sandisk|western digital|wd|kingston|crucial)( .*)?$' THEN
    RETURN 100;
  END IF;

  -- Tier 2: strong within their category, or the smart-home/wellness brands
  -- this store deliberately stocks.
  IF b ~ '^(targus|kensington|belkin|ugreen|baseus|jabra|msi|gigabyte|zotac|adata|transcend|synology|qnap|d-?link|mercusys|tenda|cudy|mikrotik|ubiquiti|volkano|port designs|mecer|switchbot|govee|lifx|nanoleaf|oura|withings|roborock|ecovacs|tuya|eufy|tapo|amazfit|jvc|hikvision|imou|verbatim|steelseries|hyperx|redragon)( .*)?$' THEN
    RETURN 78;
  END IF;

  -- Tier 3: enterprise-only. Credible, but not to a household buyer.
  IF b ~ '^(hpe|hewlett packard enterprise|cisco|juniper|aruba|fortinet|veeam|vmware|nutanix|netapp|supermicro|lenovo dcg|ibm|oracle|citrix|barracuda|sophos|trend micro|axis|extreme)( .*)?$' THEN
    RETURN 25;
  END IF;

  RETURN 50;  -- unknown: neutral
END $$;
COMMENT ON FUNCTION public.merch_brand_trust(text) IS
  'Consumer brand recognition 0-100. Unknown brands score neutral (50), never zero.';


-- ---------------------------------------------------------------------------
-- 3. PRICE -- where online conversion actually happens
-- ---------------------------------------------------------------------------
-- Stepwise rather than a smooth curve so a non-technical owner can read the
-- bands and argue with them. Anything above the residential ceiling scores 0
-- and is separately gated out; anything under ~R80 is real but too slight to
-- anchor a shop window.
CREATE OR REPLACE FUNCTION public.merch_price_fit(p_price numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN p_price IS NULL OR p_price <= 0 THEN 0
    WHEN p_price <    80 THEN  20   -- too slight to headline
    WHEN p_price <   250 THEN  70   -- impulse add-on
    WHEN p_price <   600 THEN  86
    WHEN p_price <  1500 THEN  96   -- the self-serve sweet spot
    WHEN p_price <  4000 THEN 100   -- best blend of desirability and conversion
    WHEN p_price <  8000 THEN  88
    WHEN p_price < 12000 THEN  70   -- considered purchase; needs more persuasion
    WHEN p_price <= 15000 THEN 55
    ELSE 0                          -- not a residential price point
  END::numeric;
$$;
COMMENT ON FUNCTION public.merch_price_fit(numeric) IS
  'Residential price-band fit 0-100. Peaks at R1 500-R4 000; zero above the R15 000 residential ceiling.';


-- ---------------------------------------------------------------------------
-- 4. NAME -- would a human read this title, or is it a distributor SKU line
-- ---------------------------------------------------------------------------
-- A shop window is 80% typography. `HPE 100Gb QSFP28 SR4 100m XCVR` and
-- `HP Accessories HP 100 BLK WRD Mouse` both destroy the page even when the
-- product behind them is fine, so title readability is scored, not assumed.
CREATE OR REPLACE FUNCTION public.merch_name_quality(p_name text)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  raw   text    := coalesce(p_name, '');
  n     text    := public.merch_norm(p_name);
  q     numeric := 100;
  junk  int;
  caps  int;
  words int;
BEGIN
  IF n = '' THEN RETURN 0; END IF;

  words := array_length(regexp_split_to_array(btrim(n), '\s+'), 1);
  IF words <= 1 THEN
    q := q - 30;   -- a one-word title tells a shopper nothing
  END IF;

  -- Part-number soup: tokens of 5+ characters mixing letters and digits, e.g.
  -- "P28948-B21", "AW320M", "874543-001". One is a model number a shopper can
  -- live with. Three means the title is a distributor SKU line.
  SELECT count(*) INTO junk
    FROM regexp_split_to_table(n, '[^a-z0-9]+') AS t(tok)
   WHERE length(tok) >= 5 AND tok ~ '[a-z]' AND tok ~ '[0-9]';
  q := q - least(45, greatest(0, junk - 1) * 18);

  -- Vowel-less all-caps abbreviations: "BLK WRD", "WRLS", "SLV", "NHP".
  SELECT count(*) INTO caps
    FROM regexp_split_to_table(raw, '[^A-Za-z]+') AS t(tok)
   WHERE tok = upper(tok) AND length(tok) BETWEEN 3 AND 5 AND tok !~ '[AEIOU]';
  q := q - least(18, caps * 6);

  IF length(raw) > 120 THEN
    q := q - 22;
  ELSIF length(raw) > 85 THEN
    q := q - 12;
  END IF;

  IF raw ~ '#' THEN
    q := q - 10;   -- HPE localisation suffixes such as "#ABA"
  END IF;

  IF raw ~ '[\n\r\t]' OR raw <> btrim(raw) THEN
    q := q - 8;    -- feed hygiene, e.g. "HP accessories G2 Protective Case.\n"
  END IF;

  -- Duplicated brand prefix: "HP Accessories HP 1000 Wired Mouse".
  IF n ~ '^(\S+)\s.*\y\1\y' THEN
    q := q - 8;
  END IF;

  RETURN greatest(0, least(100, q));
END $$;
COMMENT ON FUNCTION public.merch_name_quality(text) IS
  'Title readability 0-100. Penalises part-number soup, vowel-less abbreviations, over-long titles and feed whitespace artefacts.';


-- ---------------------------------------------------------------------------
-- 5. AVAILABILITY
-- ---------------------------------------------------------------------------
-- Out of stock scores 20 rather than 0 on purpose. Only ~160 of 1 084
-- residential products are in stock, and the deliberately curated smart-home
-- and wellness lines (Oura, Govee, Nanoleaf, Withings) are currently supplier
-- out-of-stock. At 0 the home page would contain no smart-home product at all
-- and would fill with mice. At 20 an in-stock equivalent always outranks an
-- out-of-stock one, but a genuinely desirable branded item can still earn a
-- place -- and the card already renders an honest backorder badge.
CREATE OR REPLACE FUNCTION public.merch_availability(
  p_in_stock boolean, p_stock_quantity integer
) RETURNS numeric LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN NOT coalesce(p_in_stock, false)     THEN  20
    WHEN p_stock_quantity IS NULL            THEN  82   -- flag says yes, feed gave no depth
    WHEN p_stock_quantity <= 0               THEN  30   -- flag and quantity disagree
    WHEN p_stock_quantity < 5                THEN  88   -- real, but thin
    ELSE                                            100
  END::numeric;
$$;
COMMENT ON FUNCTION public.merch_availability(boolean, integer) IS
  'Buy-today confidence 0-100. Out of stock scores 20, not 0, so curated-but-unstocked lines can still place.';


-- ---------------------------------------------------------------------------
-- 6. MEDIA
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.merch_media_quality(p_images text[])
RETURNS numeric LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN p_images IS NULL OR array_length(p_images, 1) IS NULL THEN 0
    WHEN coalesce(p_images[1], '') = '' THEN 0
    WHEN p_images[1] ILIKE '%placeholder%' THEN 5
    -- More angles converts better, and the product lightbox added side-scroll
    -- navigation, so multi-image listings are now genuinely worth more.
    WHEN array_length(p_images, 1) >= 4 THEN 100
    WHEN array_length(p_images, 1) >= 2 THEN  92
    ELSE 80
  END::numeric;
$$;
COMMENT ON FUNCTION public.merch_media_quality(text[]) IS
  'Photography strength 0-100. No image or a placeholder scores ~0; four or more real angles score 100.';


-- ---------------------------------------------------------------------------
-- 7. SIGNAL -- real behaviour, once there is any
-- ---------------------------------------------------------------------------
-- Log-shaped so the first sale matters a lot and the fiftieth matters little,
-- which is what stops one viral SKU from swallowing the entire shop window.
-- A paid unit counts triple a wishlist save: intent to buy beats intent to
-- remember. Kept as a pure function so the set-wise refresh query and the
-- single-product explainer cannot drift apart.
CREATE OR REPLACE FUNCTION public.merch_signal_score(
  p_paid_units numeric, p_wishlist_saves numeric
) RETURNS numeric LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT least(100, 34 * ln(1
    + greatest(0, coalesce(p_paid_units, 0)) * 3
    + greatest(0, coalesce(p_wishlist_saves, 0))))::numeric;
$$;
COMMENT ON FUNCTION public.merch_signal_score(numeric, numeric) IS
  'Observed-demand score 0-100 from paid units and wishlist saves, log-shaped so early evidence counts and runaway winners do not monopolise.';


-- ---------------------------------------------------------------------------
-- 8. Hard eligibility -- invariants, not weights
-- ---------------------------------------------------------------------------
-- Everything below is a property the home page must have regardless of how the
-- weights are tuned. If a future weight change would put a rack server in the
-- shop window, this gate is what stops it.
CREATE OR REPLACE FUNCTION public.merch_is_home_eligible(
  p_category text, p_name text, p_price numeric, p_images text[], p_is_ai boolean DEFAULT false
) RETURNS boolean LANGUAGE plpgsql STABLE
SET search_path = public AS $$
DECLARE
  v_max_price  numeric := public.merch_setting('merch.max_price',   15000);
  v_min_price  numeric := public.merch_setting('merch.min_price',      80);
  v_min_demand numeric := public.merch_setting('merch.min_demand',     35);
BEGIN
  IF coalesce(btrim(p_name), '') = '' THEN RETURN false; END IF;
  IF p_price IS NULL OR p_price < v_min_price OR p_price > v_max_price THEN RETURN false; END IF;
  IF public.merch_media_quality(p_images) < 50 THEN RETURN false; END IF;

  -- Categories that are never residential shop-window material, independent of
  -- score. Belt and braces with the demand floors above.
  IF coalesce(p_category, '') IN ('Support & Warranty', 'Servers & Data Centre') THEN
    RETURN false;
  END IF;

  RETURN public.merch_demand_tier(p_category, p_name, p_is_ai) >= v_min_demand;
END $$;
COMMENT ON FUNCTION public.merch_is_home_eligible(text, text, numeric, text[], boolean) IS
  'Hard gate for home-page candidacy: real title, residential price band, real photo, non-enterprise category, minimum consumer demand.';


-- ---------------------------------------------------------------------------
-- 9. The composite score, with its reasoning
-- ---------------------------------------------------------------------------
-- Returns the score, every component, and a human-readable list of reasons.
-- The reasons are the point: a merchandising engine nobody can interrogate is
-- indistinguishable from a random one, and the shop owner needs to be able to
-- look at the grid and ask "why is that there".
CREATE OR REPLACE FUNCTION public.score_home_product(
  p_category       text,
  p_name           text,
  p_brand          text,
  p_price          numeric,
  p_in_stock       boolean,
  p_stock_quantity integer,
  p_images         text[],
  p_is_ai          boolean DEFAULT false,
  p_signal         numeric DEFAULT 0
) RETURNS jsonb LANGUAGE plpgsql STABLE
SET search_path = public AS $$
DECLARE
  c_demand  numeric := public.merch_demand_tier(p_category, p_name, p_is_ai);
  c_brand   numeric := public.merch_brand_trust(p_brand);
  c_price   numeric := public.merch_price_fit(p_price);
  c_name    numeric := public.merch_name_quality(p_name);
  c_avail   numeric := public.merch_availability(p_in_stock, p_stock_quantity);
  c_media   numeric := public.merch_media_quality(p_images);
  c_signal  numeric := greatest(0, least(100, coalesce(p_signal, 0)));
  w_demand  numeric := public.merch_setting('merch.weight.demand',       0.30);
  w_brand   numeric := public.merch_setting('merch.weight.brand',        0.15);
  w_price   numeric := public.merch_setting('merch.weight.price',        0.15);
  w_name    numeric := public.merch_setting('merch.weight.name',         0.12);
  w_avail   numeric := public.merch_setting('merch.weight.availability', 0.18);
  w_media   numeric := public.merch_setting('merch.weight.media',        0.05);
  w_signal  numeric := public.merch_setting('merch.weight.signal',       0.05);
  w_total   numeric;
  v_score   numeric;
  v_reasons text[]  := ARRAY[]::text[];
BEGIN
  -- Normalise by the weight total instead of trusting it to sum to 1. An admin
  -- who sets one weight to 0.9 gets a re-proportioned mix, not a broken scale.
  w_total := w_demand + w_brand + w_price + w_name + w_avail + w_media + w_signal;
  IF w_total IS NULL OR w_total <= 0 THEN
    w_demand := 0.30; w_brand := 0.15; w_price := 0.15; w_name := 0.12;
    w_avail  := 0.18; w_media := 0.05; w_signal := 0.05; w_total := 1.00;
  END IF;

  v_score := (
      c_demand * w_demand + c_brand  * w_brand + c_price * w_price
    + c_name   * w_name   + c_avail  * w_avail + c_media * w_media
    + c_signal * w_signal
  ) / w_total;

  IF c_demand >= 85 THEN
    v_reasons := v_reasons || 'One of the things households search for most'::text;
  ELSIF c_demand >= 60 THEN
    v_reasons := v_reasons || 'Solid everyday consumer demand'::text;
  ELSIF c_demand < 40 THEN
    v_reasons := v_reasons || 'Niche demand -- only placed when nothing better fits'::text;
  END IF;

  IF c_brand >= 100 THEN
    v_reasons := v_reasons || 'Household-name brand, needs no explaining'::text;
  ELSIF c_brand <= 25 THEN
    v_reasons := v_reasons || 'Enterprise brand a home shopper will not recognise'::text;
  END IF;

  IF c_price >= 96 THEN
    v_reasons := v_reasons || 'Priced in the band that converts best online'::text;
  ELSIF c_price <= 55 THEN
    v_reasons := v_reasons || 'Near the top of the residential price ceiling'::text;
  END IF;

  IF c_avail >= 88 THEN
    v_reasons := v_reasons || 'In stock, can ship on the next dispatch'::text;
  ELSIF c_avail <= 30 THEN
    v_reasons := v_reasons || 'Backorder -- shown for desirability, dispatch date is honest'::text;
  END IF;

  IF c_media >= 92 THEN
    v_reasons := v_reasons || 'Multiple real product photos for the lightbox'::text;
  END IF;

  IF c_name < 70 THEN
    v_reasons := v_reasons || 'Title still reads like a distributor part number'::text;
  END IF;

  IF c_signal > 0 THEN
    v_reasons := v_reasons || 'Real customers have already bought or saved this'::text;
  END IF;

  IF coalesce(p_is_ai, false) THEN
    v_reasons := v_reasons || 'Tagged as an AI / smart product'::text;
  END IF;

  RETURN jsonb_build_object(
    'score', round(v_score, 2),
    'components', jsonb_build_object(
      'demand', c_demand, 'brand', c_brand, 'price', c_price, 'name', c_name,
      'availability', c_avail, 'media', c_media, 'signal', round(c_signal, 2)
    ),
    'reasons', to_jsonb(v_reasons)
  );
END $$;
COMMENT ON FUNCTION public.score_home_product(text, text, text, numeric, boolean, integer, text[], boolean, numeric) IS
  'Composite 0-100 home-page merchandising score plus per-factor components and human-readable reasons.';


-- ---------------------------------------------------------------------------
-- 10. The curated showcase
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.home_showcase (
  slot         text        NOT NULL,
  rank         integer     NOT NULL,
  product_id   uuid        NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  score        numeric(6,2) NOT NULL,
  components   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  reasons      jsonb       NOT NULL DEFAULT '[]'::jsonb,
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (slot, rank),
  CONSTRAINT home_showcase_rank_positive CHECK (rank >= 1 AND rank <= 48),
  -- Adding a slot is a migration on purpose: a typo in a slot name would
  -- otherwise silently produce an empty grid on the live home page.
  CONSTRAINT home_showcase_slot_known CHECK (slot IN ('ai_picks', 'featured'))
);

-- Structurally prevents the same product appearing in two grids. Index.tsx
-- previously de-duplicated the two grids in JavaScript; this makes that
-- workaround unnecessary rather than merely redundant.
CREATE UNIQUE INDEX IF NOT EXISTS home_showcase_product_unique
  ON public.home_showcase (product_id);

COMMENT ON TABLE public.home_showcase IS
  'Curated, scored product slots for the residential home page. Rebuilt by refresh_home_showcase(); read by get_home_showcase().';

ALTER TABLE public.home_showcase ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Home showcase is public" ON public.home_showcase;
CREATE POLICY "Home showcase is public"
  ON public.home_showcase FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins can manage the home showcase" ON public.home_showcase;
CREATE POLICY "Admins can manage the home showcase"
  ON public.home_showcase FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

GRANT SELECT ON public.home_showcase TO anon, authenticated;
GRANT ALL    ON public.home_showcase TO service_role;


-- The weights have to be readable by anonymous visitors, otherwise
-- score_home_product() would silently fall back to defaults for anon and to
-- the tuned values for admins -- i.e. the admin preview would not match the
-- live page. They are merchandising dials, not secrets.
DROP POLICY IF EXISTS "Anyone can view public store settings" ON public.store_settings;
CREATE POLICY "Anyone can view public store settings"
  ON public.store_settings FOR SELECT
  USING (
    key = ANY (ARRAY[
      'shipping_flat_rate', 'free_shipping_threshold', 'shipping_zones',
      'shipping_rate_table', 'dispatch_city', 'payfast_enabled'
    ])
    OR key LIKE 'merch.%'
  );

-- Seed the dials at their documented defaults so they are discoverable and
-- editable in Admin -> Settings rather than being invisible magic numbers.
INSERT INTO public.store_settings (key, value)
VALUES
  ('merch.weight.demand',       '0.30'),
  ('merch.weight.brand',        '0.15'),
  ('merch.weight.price',        '0.15'),
  ('merch.weight.name',         '0.12'),
  ('merch.weight.availability', '0.18'),
  ('merch.weight.media',        '0.05'),
  ('merch.weight.signal',       '0.05'),
  ('merch.max_price',           '15000'),
  ('merch.min_price',           '80'),
  ('merch.min_demand',          '35'),
  ('merch.max_per_brand',       '2'),
  ('merch.max_per_category',    '3')
ON CONFLICT (key) DO NOTHING;


-- ---------------------------------------------------------------------------
-- 11. The refresh
-- ---------------------------------------------------------------------------
-- Greedy selection rather than a window-function filter, because the diversity
-- caps are the whole point and greedy is the only formulation where "at most N
-- per brand" is obviously true by construction. At ~1 000 candidates it is
-- microseconds either way.
--
-- SECURITY INVOKER on purpose: cron and service_role have no auth.uid() and
-- bypass RLS; a signed-in non-admin is rejected explicitly rather than being
-- allowed to run a no-op that looks like success.
CREATE OR REPLACE FUNCTION public.refresh_home_showcase()
RETURNS TABLE(slot text, filled integer)
LANGUAGE plpgsql
SET search_path = public AS $$
DECLARE
  v_max_brand int := greatest(1, public.merch_setting('merch.max_per_brand', 2)::int);
  v_max_cat   int := greatest(1, public.merch_setting('merch.max_per_category', 3)::int);
  v_slot      text;
  v_target    int;
  v_rank      int;
  v_cand      int;
  v_brands    jsonb;
  v_cats      jsonb;
  bkey        text;
  ckey        text;
  r           record;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'refresh_home_showcase: admin role required';
  END IF;

  CREATE TEMP TABLE _merch_candidates ON COMMIT DROP AS
  WITH raw_signals AS (
    SELECT oi.product_id, sum(oi.quantity)::numeric AS units, 0::numeric AS saves
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
     WHERE o.payment_status = 'paid'
       AND o.created_at > now() - interval '180 days'
     GROUP BY oi.product_id
    UNION ALL
    SELECT w.product_id, 0::numeric, count(*)::numeric
      FROM public.wishlists w
     WHERE w.created_at > now() - interval '180 days'
     GROUP BY w.product_id
  ),
  signals AS (
    SELECT product_id, sum(units) AS units, sum(saves) AS saves
      FROM raw_signals GROUP BY product_id
  ),
  eligible AS (
    SELECT p.id, p.name, p.brand, p.category, p.price, p.in_stock,
           p.stock_quantity, p.images, p.is_ai_product,
           public.merch_signal_score(coalesce(s.units, 0), coalesce(s.saves, 0)) AS signal
      FROM public.products p
      LEFT JOIN signals s ON s.product_id = p.id
     WHERE p.is_active
       AND p.audience = 'residential'
       AND public.merch_is_home_eligible(p.category, p.name, p.price, p.images, p.is_ai_product)
  )
  SELECT e.id,
         coalesce(nullif(public.merch_norm(e.brand), ''), '(none)')    AS brand_key,
         coalesce(nullif(e.category, ''), '(none)')                    AS category_key,
         e.in_stock,
         -- AI affinity tier for the "AI Picks" grid: explicitly tagged first,
         -- then genuinely AI-adjacent consumer tech, then the best of the rest
         -- so the grid always fills instead of rendering three items.
         CASE
           WHEN e.is_ai_product THEN 3
           WHEN e.category IN ('Smart Home', 'Wearables', 'Health & Wellness', 'GPUs & AI Accelerators') THEN 2
           WHEN public.merch_norm(e.name) ~ '\y(ai|a\.i\.|npu|neural|copilot|smart|voice assistant|machine learning)\y' THEN 2
           ELSE 1
         END AS ai_tier,
         j.payload,
         (j.payload->>'score')::numeric AS score
    FROM eligible e
    CROSS JOIN LATERAL (
      SELECT public.score_home_product(
        e.category, e.name, e.brand, e.price, e.in_stock,
        e.stock_quantity, e.images, e.is_ai_product, e.signal
      ) AS payload
    ) j;

  SELECT count(*) INTO v_cand FROM _merch_candidates;

  -- A broken supplier sync must degrade to yesterday's shop window, never to a
  -- blank one.
  IF v_cand = 0 THEN
    RAISE WARNING 'refresh_home_showcase: no eligible candidates, keeping the previous showcase';
    RETURN QUERY SELECT h.slot, count(*)::int FROM public.home_showcase h GROUP BY h.slot;
    RETURN;
  END IF;

  DELETE FROM public.home_showcase;

  FOR v_slot, v_target IN
    SELECT * FROM (VALUES ('ai_picks', 8), ('featured', 8)) AS s(a, b)
  LOOP
    v_rank   := 0;
    v_brands := '{}'::jsonb;
    v_cats   := '{}'::jsonb;

    FOR r IN
      SELECT c.*
        FROM _merch_candidates c
       WHERE NOT EXISTS (
               SELECT 1 FROM public.home_showcase h WHERE h.product_id = c.id
             )
       ORDER BY
         CASE WHEN v_slot = 'ai_picks' THEN c.ai_tier ELSE 0 END DESC,
         c.score DESC,
         c.in_stock DESC,
         c.id                      -- final tie-break keeps the output stable
    LOOP
      EXIT WHEN v_rank >= v_target;

      bkey := r.brand_key;
      ckey := r.category_key;
      CONTINUE WHEN coalesce((v_brands->>bkey)::int, 0) >= v_max_brand;
      CONTINUE WHEN coalesce((v_cats->>ckey)::int, 0)   >= v_max_cat;

      v_rank := v_rank + 1;
      INSERT INTO public.home_showcase
        (slot, rank, product_id, score, components, reasons)
      VALUES
        (v_slot, v_rank, r.id, r.score,
         coalesce(r.payload->'components', '{}'::jsonb),
         coalesce(r.payload->'reasons',    '[]'::jsonb));

      v_brands := v_brands || jsonb_build_object(bkey, coalesce((v_brands->>bkey)::int, 0) + 1);
      v_cats   := v_cats   || jsonb_build_object(ckey, coalesce((v_cats->>ckey)::int, 0) + 1);
    END LOOP;
  END LOOP;

  RETURN QUERY SELECT h.slot, count(*)::int FROM public.home_showcase h GROUP BY h.slot;
END $$;
COMMENT ON FUNCTION public.refresh_home_showcase() IS
  'Rebuilds home_showcase: scores every eligible residential product, then greedily fills each slot subject to per-brand and per-category diversity caps. Never blanks the showcase.';

REVOKE ALL ON FUNCTION public.refresh_home_showcase() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_home_showcase() TO authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 12. The read path
-- ---------------------------------------------------------------------------
-- Re-checks is_active so a product deactivated between refreshes vanishes from
-- the home page immediately instead of linking to a dead detail page.
CREATE OR REPLACE FUNCTION public.get_home_showcase(
  p_slot text, p_limit integer DEFAULT 8
) RETURNS TABLE(
  id             uuid,
  name           text,
  description    text,
  price          numeric,
  category       text,
  brand          text,
  sku            text,
  images         text[],
  in_stock       boolean,
  stock_quantity integer,
  is_ai_product  boolean,
  specifications jsonb,
  created_at     timestamptz,
  score          numeric,
  reasons        jsonb,
  rank           integer
) LANGUAGE sql STABLE
SET search_path = public AS $$
  SELECT p.id, p.name, p.description, p.price, p.category, p.brand, p.sku,
         p.images, p.in_stock, p.stock_quantity, p.is_ai_product,
         p.specifications, p.created_at,
         h.score, h.reasons, h.rank
    FROM public.home_showcase h
    JOIN public.products p ON p.id = h.product_id
   WHERE h.slot = p_slot
     AND p.is_active
   ORDER BY h.rank
   LIMIT greatest(1, least(coalesce(p_limit, 8), 24));
$$;
COMMENT ON FUNCTION public.get_home_showcase(text, integer) IS
  'Curated home-page products for a slot (ai_picks | featured), newest refresh, active only.';

GRANT EXECUTE ON FUNCTION public.get_home_showcase(text, integer) TO anon, authenticated, service_role;


-- Dry-run view: every eligible product with its score and reasoning, so the
-- ranking can be inspected and argued with before it ever reaches the page.
CREATE OR REPLACE VIEW public.home_showcase_candidates AS
SELECT p.id,
       p.name,
       p.brand,
       p.category,
       p.price,
       p.in_stock,
       p.is_ai_product,
       (j.payload->>'score')::numeric AS score,
       j.payload->'components'        AS components,
       j.payload->'reasons'           AS reasons
  FROM public.products p
  CROSS JOIN LATERAL (
    SELECT public.score_home_product(
      p.category, p.name, p.brand, p.price, p.in_stock,
      p.stock_quantity, p.images, p.is_ai_product, 0
    ) AS payload
  ) j
 WHERE p.is_active
   AND p.audience = 'residential'
   AND public.merch_is_home_eligible(p.category, p.name, p.price, p.images, p.is_ai_product);

COMMENT ON VIEW public.home_showcase_candidates IS
  'Every home-page-eligible residential product with its merchandising score and reasoning. Excludes the behavioural signal term (use refresh_home_showcase for the live ranking).';

GRANT SELECT ON public.home_showcase_candidates TO authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 13. Keep it fresh
-- ---------------------------------------------------------------------------
-- Every 3 hours, offset off the hour so it never contends with axiz-sync
-- (*/15) or refresh-product-facets (:17).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-home-showcase') THEN
    PERFORM cron.schedule(
      'refresh-home-showcase', '43 */3 * * *',
      $cron$ SELECT public.refresh_home_showcase(); $cron$
    );
  END IF;
END $$;

-- Populate immediately so the first page load after deploy is already curated.
SELECT public.refresh_home_showcase();
