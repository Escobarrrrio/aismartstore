-- ===========================================================================
-- African AI stories for AI Pulse, ingested in SQL via pg_net
-- ===========================================================================
--
-- WHY THIS IS NOT IN THE EDGE FUNCTION
-- ------------------------------------
-- sync-ai-pulse already carries the eight African feeds, and it has been
-- returning `local: 0` on every run. Diagnosing it against production showed
-- the cause is the network path, not the code:
--
--   * From pg_net, techcentral.co.za returns real RSS (20 <item> elements) and
--     disrupt-africa.com returns 10.
--   * From the edge runtime, the same feeds yield nothing, and the function's
--     own error list named only the first two feeds -- while techcabal and
--     techpoint answer pg_net with a Cloudflare 403 interstitial.
--
-- These publishers front their feeds with bot protection that treats Supabase's
-- edge egress differently from its database egress. RSS exists to be machine
-- read, and we send a normal browser User-Agent to a public feed -- but we
-- cannot control which egress IP a given WAF trusts. pg_net demonstrably works,
-- so the ingestion lives here.
--
-- pg_net is asynchronous: net.http_get() returns a request id and the response
-- lands in net._http_response later. So this is two phases -- enqueue, then
-- ingest a few minutes later -- wired to two cron jobs.
--
-- KEYWORD PRECISION
-- -----------------
-- The edge function matched AI stories with `lower(text).includes("ai")`. On
-- the real TechCentral feed that classified "The tech master plan for the Cape
-- Winelands Airport", "Apple at Work" and "Canal+ concedes MultiChoice
-- turnaround" as AI news, and on Disrupt Africa it matched nothing but crypto
-- spam ("Top Trending Altcoins", "Meme Coins by Market Capitalization").
--
-- ai_pulse_is_ai_story() requires whole-word matches for the short ambiguous
-- tokens and phrase matches for the rest. Measured on the same live feeds it
-- selects "Radical rethink for South Africa's national AI policy", "Huawei
-- Connect 2026: taking South African AI beyond pilots" and "South African IT
-- spending surging as AI boom lands locally", and rejects every crypto item.
-- Fewer stories, all of them real.
--
-- To revert:
--   SELECT cron.unschedule('ai-pulse-enqueue-feeds');
--   SELECT cron.unschedule('ai-pulse-ingest-feeds');
--   DROP TABLE public.ai_pulse_feed_requests, public.ai_pulse_feeds;
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. The feed roster, editable without a deploy
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_pulse_feeds (
  source                text PRIMARY KEY,
  country               text NOT NULL,
  url                   text NOT NULL,
  enabled               boolean NOT NULL DEFAULT true,
  last_status           integer,
  last_ok_at            timestamptz,
  last_error            text,
  consecutive_failures  integer NOT NULL DEFAULT 0,
  items_last_run        integer NOT NULL DEFAULT 0
);

COMMENT ON TABLE public.ai_pulse_feeds IS
  'African tech-press RSS sources for AI Pulse, with per-feed health. Disable a feed by setting enabled = false; no deploy needed.';

ALTER TABLE public.ai_pulse_feeds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage pulse feeds" ON public.ai_pulse_feeds;
CREATE POLICY "Admins manage pulse feeds" ON public.ai_pulse_feeds
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
GRANT ALL ON public.ai_pulse_feeds TO service_role;

-- techcabal and techpoint are seeded disabled: both answer with a Cloudflare
-- challenge rather than RSS. Left in the table, off, so the decision is
-- visible and reversible rather than silently dropped.
INSERT INTO public.ai_pulse_feeds (source, country, url, enabled) VALUES
  ('techcentral',   'South Africa', 'https://techcentral.co.za/feed/',      true),
  ('mybroadband',   'South Africa', 'https://mybroadband.co.za/news/feed',  true),
  ('businesstech',  'South Africa', 'https://businesstech.co.za/feed/',     true),
  ('ventureburn',   'South Africa', 'https://ventureburn.com/feed/',        true),
  ('itnewsafrica',  'Pan-African',  'https://www.itnewsafrica.com/feed/',   true),
  ('disruptafrica', 'Pan-African',  'https://disrupt-africa.com/feed/',     true),
  ('techcabal',     'Nigeria',      'https://techcabal.com/feed/',          false),
  ('techpoint',     'Nigeria',      'https://techpoint.africa/feed/',       false)
ON CONFLICT (source) DO NOTHING;


-- ---------------------------------------------------------------------------
-- 2. In-flight pg_net requests
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_pulse_feed_requests (
  request_id   bigint PRIMARY KEY,
  source       text NOT NULL REFERENCES public.ai_pulse_feeds(source) ON DELETE CASCADE,
  requested_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_pulse_feed_requests ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.ai_pulse_feed_requests TO service_role;
COMMENT ON TABLE public.ai_pulse_feed_requests IS
  'Maps an in-flight pg_net request id to the feed that issued it. Rows are consumed by ai_pulse_ingest_feed_responses().';


-- ---------------------------------------------------------------------------
-- 3. Helpers
-- ---------------------------------------------------------------------------

-- RSS titles arrive with numeric and named HTML entities: "DStv&#8217;s",
-- "TCS &#124; Icasa". Rendering those raw looks broken.
CREATE OR REPLACE FUNCTION public.decode_feed_entities(p_text text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
  SELECT CASE WHEN p_text IS NULL THEN NULL ELSE
    replace(replace(replace(replace(replace(replace(replace(replace(replace(
    replace(replace(replace(replace(replace(replace(
      p_text,
      '&#8217;', ''''), '&#8216;', ''''), '&#8220;', '"'), '&#8221;', '"'),
      '&#8211;', '-'),  '&#8212;', '-'),  '&#124;', '|'),   '&#039;', ''''),
      '&#38;', '&'),    '&hellip;', '...'), '&nbsp;', ' '), '&quot;', '"'),
      '&apos;', ''''),  '&lt;', '<'),      '&gt;', '>')
  END;
$fn$;

-- `&amp;` last and separately: doing it inside the chain above would let an
-- encoded "&amp;#8217;" decode twice into a stray apostrophe.
CREATE OR REPLACE FUNCTION public.clean_feed_text(p_text text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
  SELECT nullif(btrim(regexp_replace(
    replace(
      public.decode_feed_entities(
        regexp_replace(
          replace(replace(coalesce(p_text,''), '<![CDATA[', ''), ']]>', ''),
          '<[^>]*?>', '', 'g')
      ),
    '&amp;', '&'),
    '\s+', ' ', 'g')), '');
$fn$;

-- Whole-word matching for the short ambiguous tokens, phrases for the rest.
-- See the header for what the old substring filter let through.
CREATE OR REPLACE FUNCTION public.ai_pulse_is_ai_story(p_text text)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
  SELECT lower(coalesce(p_text,'')) ~ '\y(ai|a\.i\.|llms?|gpts?|chatgpt|openai|anthropic|claude|gemini|copilot|genai|agentic|nvidia)\y'
      OR lower(coalesce(p_text,'')) ~ '(artificial intelligence|machine learning|neural network|deep learning|large language model|generative ai|foundation model|ai model|ai chip|data centre for ai)';
$fn$;

COMMENT ON FUNCTION public.ai_pulse_is_ai_story(text) IS
  'True when a headline or summary is genuinely about AI. Word-boundary matching for ai/llm/gpt so "Cape Winelands Airport" and "available" no longer qualify.';


-- ---------------------------------------------------------------------------
-- 4. Phase one: fire the requests
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ai_pulse_enqueue_feeds()
RETURNS integer LANGUAGE plpgsql
SET search_path = public AS $fn$
DECLARE
  f   record;
  rid bigint;
  n   integer := 0;
BEGIN
  -- Drop anything older than an hour: pg_net expires responses, so a request
  -- id that never got answered is dead weight, not something to keep waiting on.
  DELETE FROM public.ai_pulse_feed_requests WHERE requested_at < now() - interval '1 hour';

  FOR f IN SELECT * FROM public.ai_pulse_feeds WHERE enabled LOOP
    SELECT net.http_get(
      url := f.url,
      headers := jsonb_build_object(
        -- A plain desktop UA. A self-identifying bot string is challenged by
        -- the WAF in front of most of these WordPress sites even for a public
        -- feed published expressly for syndication.
        'User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept', 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8'
      ),
      timeout_milliseconds := 15000
    ) INTO rid;

    INSERT INTO public.ai_pulse_feed_requests (request_id, source) VALUES (rid, f.source)
    ON CONFLICT (request_id) DO NOTHING;
    n := n + 1;
  END LOOP;

  RETURN n;
END $fn$;

COMMENT ON FUNCTION public.ai_pulse_enqueue_feeds() IS
  'Phase one: issues one pg_net GET per enabled feed. Responses are collected later by ai_pulse_ingest_feed_responses().';


-- ---------------------------------------------------------------------------
-- 5. Phase two: parse and store
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ai_pulse_ingest_feed_responses()
RETURNS TABLE(source text, status integer, parsed integer, ai_matched integer, inserted integer)
LANGUAGE plpgsql
SET search_path = public AS $fn$
DECLARE
  req        record;
  resp       record;
  blk        text;
  v_title    text;
  v_url      text;
  v_summary  text;
  v_pub      timestamptz;
  n_parsed   integer;
  n_ai       integer;
  n_ins      integer;
BEGIN
  FOR req IN SELECT * FROM public.ai_pulse_feed_requests ORDER BY requested_at LOOP
    SELECT r.status_code, r.content INTO resp
      FROM net._http_response r WHERE r.id = req.request_id;

    -- No response yet: leave the row for the next pass rather than losing it.
    CONTINUE WHEN NOT FOUND;

    n_parsed := 0; n_ai := 0; n_ins := 0;

    IF resp.status_code = 200 AND coalesce(resp.content,'') ~ '<item[ >]' THEN
      -- Every quantifier below is non-greedy on purpose. A Postgres ARE takes
      -- its greediness from the FIRST quantifier, so one greedy `[^>]*` or
      -- `(...)?` ahead of the capture flips the whole pattern greedy and a
      -- single "item" swallows the entire feed. That is exactly what happened
      -- on the first live run: every story arrived as one row whose title was
      -- the concatenation of the whole document.
      FOR blk IN
        SELECT m[1] FROM regexp_matches(resp.content, '<item[^>]*?>([\s\S]*?)</item>', 'g') AS m
      LOOP
        n_parsed := n_parsed + 1;

        v_title   := public.clean_feed_text((regexp_match(blk, '<title>([\s\S]*?)</title>'))[1]);
        v_url     := btrim(coalesce(
                       (regexp_match(blk, '<link>([\s\S]*?)</link>'))[1],
                       (regexp_match(blk, '<guid[^>]*?>([\s\S]*?)</guid>'))[1], ''));
        v_summary := left(coalesce(public.clean_feed_text(
                       (regexp_match(blk, '<description>([\s\S]*?)</description>'))[1]), ''), 280);

        BEGIN
          v_pub := ((regexp_match(blk, '<pubDate>([\s\S]*?)</pubDate>'))[1])::timestamptz;
        EXCEPTION WHEN others THEN
          v_pub := NULL;   -- an unparseable date must not abort the whole feed
        END;

        CONTINUE WHEN v_title IS NULL OR v_url = '' OR v_pub IS NULL;
        CONTINUE WHEN v_url !~* '^https?://';
        -- A title this long means the parse went wrong, not that the headline
        -- is long. Cheap guard against ever storing a whole feed as one row.
        CONTINUE WHEN length(v_title) > 300;
        -- Only recent items; these feeds carry evergreen and sponsored posts
        -- with old dates that would otherwise churn into the grid.
        CONTINUE WHEN v_pub < now() - interval '45 days' OR v_pub > now() + interval '1 day';
        CONTINUE WHEN NOT public.ai_pulse_is_ai_story(v_title || ' ' || coalesce(v_summary,''));

        n_ai := n_ai + 1;

        INSERT INTO public.ai_pulse_items (title, url, source, category, summary, published_at)
        VALUES (v_title, v_url, req.source, 'local', v_summary, v_pub)
        ON CONFLICT (url) DO UPDATE
          SET title = EXCLUDED.title,
              summary = EXCLUDED.summary,
              source = EXCLUDED.source,
              category = EXCLUDED.category;
        n_ins := n_ins + 1;
      END LOOP;

      UPDATE public.ai_pulse_feeds
         SET last_status = resp.status_code, last_ok_at = now(), last_error = NULL,
             consecutive_failures = 0, items_last_run = n_ins
       WHERE public.ai_pulse_feeds.source = req.source;
    ELSE
      -- A 200 carrying HTML rather than RSS is a bot-challenge page, and is
      -- recorded as a failure so it shows up in the feed health view instead
      -- of looking like a quiet success.
      UPDATE public.ai_pulse_feeds
         SET last_status = resp.status_code,
             last_error = CASE
               WHEN resp.status_code <> 200 THEN 'HTTP ' || resp.status_code
               ELSE 'HTTP 200 but no <item> elements (bot challenge or non-RSS payload)'
             END,
             consecutive_failures = public.ai_pulse_feeds.consecutive_failures + 1,
             items_last_run = 0
       WHERE public.ai_pulse_feeds.source = req.source;
    END IF;

    DELETE FROM public.ai_pulse_feed_requests WHERE request_id = req.request_id;

    source := req.source; status := resp.status_code;
    parsed := n_parsed; ai_matched := n_ai; inserted := n_ins;
    RETURN NEXT;
  END LOOP;
END $fn$;

COMMENT ON FUNCTION public.ai_pulse_ingest_feed_responses() IS
  'Phase two: parses each answered feed, keeps only genuine AI stories from the last 45 days, and upserts them as category=local.';

REVOKE ALL ON FUNCTION public.ai_pulse_enqueue_feeds() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ai_pulse_ingest_feed_responses() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_pulse_enqueue_feeds() TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_pulse_ingest_feed_responses() TO service_role;


-- ---------------------------------------------------------------------------
-- 6. Schedule
-- ---------------------------------------------------------------------------
-- Enqueue on the hour every 3 hours, ingest 7 minutes later -- comfortably
-- longer than any of these feeds takes to answer, and well inside pg_net's
-- response retention.
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ai-pulse-enqueue-feeds') THEN
    PERFORM cron.schedule('ai-pulse-enqueue-feeds', '5 */3 * * *',
      $cron$ SELECT public.ai_pulse_enqueue_feeds(); $cron$);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ai-pulse-ingest-feeds') THEN
    PERFORM cron.schedule('ai-pulse-ingest-feeds', '12 */3 * * *',
      $cron$ SELECT public.ai_pulse_ingest_feed_responses(); $cron$);
  END IF;
END $do$;
