-- ===========================================================================
-- AI Pulse story ranking, and a daily digest that never repeats itself
-- ===========================================================================
--
-- The weekly digest ordered stories by "African first, then newest". That put
-- "Radisson Hotel Group and Accenture Redefine Travel Discovery on ChatGPT" in
-- the subject line, ahead of "Radical rethink for South Africa's national AI
-- policy" -- a global hospitality press release outranking the single most
-- relevant story of the week for a South African audience.
--
-- Ordering is now a score, not a sort. Five factors, each defensible:
--
--   locality    30%  A Gqeberha reader cares more about Icasa than about a
--                    Radisson pilot in Europe. South Africa > pan-African >
--                    global news > research preprints.
--   recency     25%  Decays over 72 hours. A three-day-old headline in a daily
--                    email is a reason to unsubscribe.
--   commercial  20%  Does the story map to something we can actually sell?
--                    This is the whole point: buzz that leads to a product page.
--   headline    15%  Crypto spam, listicles and sponsored posts are demoted
--                    hard. Disrupt Africa's feed is mostly "Top Trending
--                    Altcoins" -- real RSS, worthless to this audience.
--   authority   10%  A working newsroom outranks an aggregator.
--
-- DAILY WITHOUT REPETITION
-- ------------------------
-- Sending daily is only credible if every send is new. newsletter_story_sends
-- records every story that has ever gone out, keyed by item, so a story can be
-- used exactly once. The builder refuses to draft at all unless it has at least
-- `p_min_stories` genuinely unsent, above-threshold items -- so a quiet news day
-- produces no email rather than a padded one. Six subscribers will forgive
-- silence; they will not forgive yesterday's headlines resent.
--
-- To revert: SELECT cron.unschedule('ai-pulse-daily-digest');
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Never send the same story twice
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.newsletter_story_sends (
  item_id     uuid PRIMARY KEY REFERENCES public.ai_pulse_items(id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES public.newsletter_campaigns(id) ON DELETE SET NULL,
  sent_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.newsletter_story_sends ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.newsletter_story_sends TO service_role;
COMMENT ON TABLE public.newsletter_story_sends IS
  'One row per story ever included in a campaign. The primary key on item_id is what makes a daily cadence non-repeating.';


-- ---------------------------------------------------------------------------
-- 2. Headline quality
-- ---------------------------------------------------------------------------
-- Disrupt Africa returns real RSS that is largely paid crypto placement
-- ("5 Top Trending Altcoins to Buy Now", "Meme Coins by Market Capitalization").
-- Those are not AI stories and must never headline a shopping newsletter.
CREATE OR REPLACE FUNCTION public.ai_pulse_headline_quality(p_title text)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $fn$
DECLARE
  t text := lower(coalesce(p_title, ''));
  q numeric := 80;
BEGIN
  IF t = '' THEN RETURN 0; END IF;

  -- Paid crypto placement. Hard floor, not a deduction.
  IF t ~ '\y(altcoin|meme coin|memecoin|shiba|dogecoin|bitcoin halving|apemax|presale|price prediction|whales|passive income|100x)\y' THEN
    RETURN 0;
  END IF;

  -- Undisclosed-advert tells.
  IF t ~ '\y(sponsored|advertorial|press release|partner content)\y' THEN
    RETURN 5;
  END IF;

  -- Listicles read as filler in a curated digest.
  IF t ~ '^\s*[0-9]{1,2}\s' OR t ~ '\y(top [0-9]+|[0-9]+ (best|ways|things|reasons))\y' THEN
    q := q - 30;
  END IF;

  -- SHOUTING.
  IF p_title = upper(p_title) AND length(p_title) > 12 THEN q := q - 25; END IF;

  -- Substance proxies: a headline too short says nothing, too long is a
  -- summary that will be truncated in every inbox.
  IF length(p_title) < 25  THEN q := q - 15; END IF;
  IF length(p_title) > 110 THEN q := q - 10; END IF;

  -- A real, specific story usually names something.
  IF p_title ~ '[A-Z][a-z]+' THEN q := q + 10; END IF;

  RETURN greatest(0, least(100, q));
END $fn$;


-- ---------------------------------------------------------------------------
-- 3. The composite story score
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ai_pulse_story_score(
  p_title        text,
  p_summary      text,
  p_source       text,
  p_category     text,
  p_published_at timestamptz,
  p_country      text DEFAULT NULL
) RETURNS numeric
LANGUAGE plpgsql STABLE
SET search_path = public AS $fn$
DECLARE
  c_local      numeric;
  c_recency    numeric;
  c_commercial numeric;
  c_headline   numeric := public.ai_pulse_headline_quality(p_title);
  c_authority  numeric;
  v_hours      numeric := greatest(0, extract(epoch from (now() - coalesce(p_published_at, now()))) / 3600.0);
BEGIN
  -- Locality. This is the biggest single lever and the one the old ordering
  -- got wrong: "local" was treated as one bucket, so Nigeria and a global
  -- press release ranked alike for a Gqeberha reader.
  c_local := CASE
    WHEN p_country = 'South Africa'                     THEN 100
    WHEN p_country = 'Pan-African'                      THEN  78
    WHEN p_country IS NOT NULL                          THEN  66   -- other African desk
    WHEN p_category = 'news'                            THEN  45   -- Hacker News: global
    WHEN p_category = 'research'                        THEN  32   -- arXiv preprints
    ELSE 40
  END;

  -- Recency, decaying over three days. In a daily send, yesterday is already
  -- old and anything past 72h has no place at all.
  c_recency := CASE
    WHEN v_hours <= 12  THEN 100
    WHEN v_hours <= 24  THEN  88
    WHEN v_hours <= 48  THEN  62
    WHEN v_hours <= 72  THEN  35
    ELSE 10
  END;

  -- Can a reader buy anything off the back of this? An unmatched story still
  -- earns a floor, because a great SA policy story is worth leading with even
  -- when it sells nothing directly.
  c_commercial := CASE
    WHEN array_length(public.ai_pulse_story_categories(
           coalesce(p_title,'') || ' ' || coalesce(p_summary,'')), 1) > 0 THEN 100
    ELSE 25
  END;

  c_authority := CASE lower(coalesce(p_source,''))
    WHEN 'techcentral'  THEN 100
    WHEN 'mybroadband'  THEN  92
    WHEN 'businesstech' THEN  85
    WHEN 'ventureburn'  THEN  80
    WHEN 'itnewsafrica' THEN  72
    WHEN 'techpoint'    THEN  70
    WHEN 'techcabal'    THEN  70
    WHEN 'arxiv'        THEN  60
    WHEN 'hn'           THEN  55
    WHEN 'disruptafrica' THEN 35   -- real feed, mostly paid crypto placement
    ELSE 50
  END;

  RETURN round(
      c_local      * 0.30
    + c_recency    * 0.25
    + c_commercial * 0.20
    + c_headline   * 0.15
    + c_authority  * 0.10
  , 2);
END $fn$;

COMMENT ON FUNCTION public.ai_pulse_story_score(text, text, text, text, timestamptz, text) IS
  'Ranks an AI Pulse story 0-100 for newsletter placement: locality 30, recency 25, commercial match 20, headline quality 15, source authority 10.';


-- ---------------------------------------------------------------------------
-- 4. Ranked, unsent candidates
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.ai_pulse_digest_candidates AS
SELECT i.id, i.title, i.url, i.summary, i.source, i.category, i.published_at,
       f.country,
       public.ai_pulse_story_score(i.title, i.summary, i.source, i.category, i.published_at, f.country) AS score
  FROM public.ai_pulse_items i
  LEFT JOIN public.ai_pulse_feeds f ON f.source = i.source
 WHERE i.title IS NOT NULL
   AND i.published_at > now() - interval '72 hours'
   AND NOT EXISTS (SELECT 1 FROM public.newsletter_story_sends s WHERE s.item_id = i.id);

GRANT SELECT ON public.ai_pulse_digest_candidates TO authenticated, service_role;
COMMENT ON VIEW public.ai_pulse_digest_candidates IS
  'Stories eligible for the next digest: under 72 hours old, never sent, with their ranking score.';
