--
-- PostgreSQL database dump
--


-- Dumped from database version 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1)
-- Dumped by pg_dump version 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

-- CREATE SCHEMA public; (already exists on a Supabase project)


--
-- Name: app_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.app_role AS ENUM (
    'customer',
    'admin'
);


--
-- Name: order_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.order_status AS ENUM (
    'pending',
    'paid',
    'shipped',
    'delivered',
    'returned'
);


--
-- Name: payment_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payment_status AS ENUM (
    'unpaid',
    'paid',
    'refunded',
    'partially_refunded'
);


--
-- Name: return_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.return_status AS ENUM (
    'requested',
    'approved',
    'received',
    'refunded',
    'rejected'
);


--
-- Name: stock_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.stock_status AS ENUM (
    'in_stock',
    'low_stock',
    'out_of_stock'
);


--
-- Name: ticket_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.ticket_status AS ENUM (
    'open',
    'pending',
    'resolved'
);


--
-- Name: ticket_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.ticket_type AS ENUM (
    'return',
    'refund',
    'inquiry'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: compliance_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.compliance_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity_legal_name text NOT NULL,
    cipc_registration_number text,
    vat_number text,
    tax_reference_number text,
    csd_supplier_number text,
    bbbee_level text,
    bbbee_certificate_url text,
    bank_name text,
    bank_account_number text,
    bank_branch_code text,
    account_manager_name text,
    account_manager_email text,
    account_manager_phone text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ai_pulse_enqueue_feeds(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ai_pulse_enqueue_feeds() RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
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
END $$;


--
-- Name: ai_pulse_headline_quality(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ai_pulse_headline_quality(p_title text) RETURNS numeric
    LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
    SET search_path TO 'public', 'pg_temp'
    AS $$
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
END $$;


--
-- Name: ai_pulse_ingest_feed_responses(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ai_pulse_ingest_feed_responses() RETURNS TABLE(source text, status integer, parsed integer, ai_matched integer, inserted integer)
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
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
END $$;


--
-- Name: ai_pulse_is_ai_story(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ai_pulse_is_ai_story(p_text text) RETURNS boolean
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT lower(coalesce(p_text,'')) ~ '\y(ai|a\.i\.|llms?|gpts?|chatgpt|openai|anthropic|claude|gemini|copilot|genai|agentic|nvidia)\y'
      OR lower(coalesce(p_text,'')) ~ '(artificial intelligence|machine learning|neural network|deep learning|large language model|generative ai|foundation model|ai model|ai chip|data centre for ai)';
$$;


--
-- Name: ai_pulse_story_categories(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ai_pulse_story_categories(p_text text) RETURNS text[]
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT CASE
    WHEN lower(coalesce(p_text,'')) ~ '\y(smart home|smart bulb|smart light|robot vacuum|doorbell|thermostat|home automation)\y'
      THEN ARRAY['Smart Home','Peripherals']
    WHEN lower(coalesce(p_text,'')) ~ '\y(wearable|smart ?watch|fitness|health|sleep|ring)\y'
      THEN ARRAY['Wearables','Health & Wellness']
    WHEN lower(coalesce(p_text,'')) ~ '\y(gpu|nvidia|chip|accelerator|compute|data ?cent(re|er)|training)\y'
      THEN ARRAY['GPUs & AI Accelerators','Storage','Memory']
    WHEN lower(coalesce(p_text,'')) ~ '\y(remote work|hybrid|productivity|meeting|video call|collaboration|copilot)\y'
      THEN ARRAY['Peripherals','Monitors & Displays']
    WHEN lower(coalesce(p_text,'')) ~ '\y(network|connectivity|broadband|fibre|fiber|5g|wi-?fi|spectrum|icasa)\y'
      THEN ARRAY['Networking']
    WHEN lower(coalesce(p_text,'')) ~ '\y(laptop|notebook|pc|device|hardware|upgrade)\y'
      THEN ARRAY['Laptops','Desktops & Workstations','Storage']
    WHEN lower(coalesce(p_text,'')) ~ '\y(security|cyber|breach|identity|privacy|popia)\y'
      THEN ARRAY['Networking','Storage']
    ELSE ARRAY[]::text[]
  END;
$$;


--
-- Name: ai_pulse_story_score(text, text, text, text, timestamp with time zone, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ai_pulse_story_score(p_title text, p_summary text, p_source text, p_category text, p_published_at timestamp with time zone, p_country text DEFAULT NULL::text) RETURNS numeric
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public'
    AS $$
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
END $$;


--
-- Name: audit_spend_cap_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_spend_cap_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  PERFORM public.sec_log(
    'spend_cap_changed',
    CASE WHEN NEW.daily_cap_zar   > OLD.daily_cap_zar
           OR NEW.monthly_cap_zar > OLD.monthly_cap_zar
           OR NEW.daily_call_cap  > OLD.daily_call_cap
           OR (OLD.hard_stop AND NOT NEW.hard_stop)
           OR (OLD.enabled AND NOT NEW.enabled)
         THEN 'high'      -- loosened: this is the direction that costs money
         ELSE 'info' END,
    coalesce(auth.uid()::text, 'service_role'),
    jsonb_build_object(
      'provider', NEW.provider,
      'before', jsonb_build_object('daily', OLD.daily_cap_zar, 'monthly', OLD.monthly_cap_zar,
                                   'calls', OLD.daily_call_cap, 'hard_stop', OLD.hard_stop,
                                   'enabled', OLD.enabled),
      'after',  jsonb_build_object('daily', NEW.daily_cap_zar, 'monthly', NEW.monthly_cap_zar,
                                   'calls', NEW.daily_call_cap, 'hard_stop', NEW.hard_stop,
                                   'enabled', NEW.enabled)));
  NEW.updated_at := now();
  RETURN NEW;
END $$;


--
-- Name: backfill_audience_batch(integer, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.backfill_audience_batch(batch_size integer DEFAULT 3000, price_cap numeric DEFAULT 15000) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE affected int;
BEGIN
  WITH batch AS (
    SELECT id, CASE WHEN price <= price_cap THEN 'residential' ELSE 'business' END AS new_aud
    FROM public.products
    WHERE is_active = true
      AND (audience IS DISTINCT FROM CASE WHEN price <= price_cap THEN 'residential' ELSE 'business' END)
    LIMIT batch_size
  )
  UPDATE public.products p SET audience = batch.new_aud
  FROM batch WHERE p.id = batch.id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;


--
-- Name: biz_close_rate(numeric, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.biz_close_rate(p_price numeric, p_in_stock boolean) RETURNS numeric
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT greatest(0.0000001, (
    0.12 / (1 + power(greatest(coalesce(p_price,0),1) / 2000.0, 1.15))
  ) * CASE WHEN coalesce(p_in_stock,false) THEN 1.6 ELSE 0.5 END)::numeric;
$$;


--
-- Name: biz_repeat_factor(numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.biz_repeat_factor(p_price numeric) RETURNS numeric
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT (1 + 6.0 / (1 + greatest(coalesce(p_price,0),1) / 1500.0))::numeric;
$$;


--
-- Name: build_ai_pulse_digest(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.build_ai_pulse_digest(p_days integer DEFAULT 7, p_stories integer DEFAULT 5) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  v_site      text := 'https://aismartstore.co.za';
  v_story     record;
  v_prod      record;
  v_html      text := '';
  v_cards     text;
  v_subject   text;
  v_lead      text;
  v_count     int := 0;
  v_id        uuid;
BEGIN
  -- African stories first, then anything else that week. `category = 'local'`
  -- is the SQL-ingested African press; those are the differentiator nobody
  -- else in SA e-commerce is publishing.
  FOR v_story IN
    SELECT title, url, summary, source, category, published_at
      FROM public.ai_pulse_items
     WHERE published_at > now() - make_interval(days => p_days)
       AND title IS NOT NULL
     ORDER BY (category = 'local') DESC, published_at DESC
     LIMIT p_stories
  LOOP
    v_count := v_count + 1;
    IF v_lead IS NULL THEN v_lead := v_story.title; END IF;

    v_cards := '';
    -- Up to two products per story, ranked by the same engine that ranks the
    -- home page, restricted to things actually in stock so nobody clicks
    -- through to a backorder.
    FOR v_prod IN
      SELECT p.id, p.name, p.price, p.brand, p.images[1] AS image
        FROM public.products p
       WHERE p.is_active
         AND p.audience = 'residential'
         AND p.in_stock
         AND p.category = ANY (public.ai_pulse_story_categories(v_story.title || ' ' || coalesce(v_story.summary,'')))
         AND public.merch_is_home_eligible(p.category, p.name, p.price, p.images, p.is_ai_product)
       ORDER BY (public.score_home_product(
                   p.category, p.name, p.brand, p.price, p.in_stock,
                   p.stock_quantity, p.images, p.is_ai_product, 0)->>'score')::numeric DESC
       LIMIT 2
    LOOP
      v_cards := v_cards ||
        '<td style="padding:8px;vertical-align:top;width:50%">' ||
          '<a href="' || v_site || '/product/' || v_prod.id ||
             '?utm_source=newsletter&utm_medium=email&utm_campaign=ai_pulse_weekly" ' ||
             'style="text-decoration:none;color:#111">' ||
            '<img src="' || coalesce(v_prod.image,'') || '" width="120" height="120" ' ||
              'style="display:block;object-fit:contain;background:#fff;border:1px solid #eee;border-radius:8px" alt="">' ||
            '<div style="font-size:13px;font-weight:600;margin-top:8px;line-height:1.35">' ||
              left(coalesce(v_prod.name,''), 70) || '</div>' ||
            '<div style="font-size:14px;font-weight:800;margin-top:4px">R' ||
              to_char(round(v_prod.price), 'FM999G999') || '</div>' ||
          '</a>' ||
        '</td>';
    END LOOP;

    v_html := v_html ||
      '<div style="margin:0 0 28px 0;padding:0 0 24px 0;border-bottom:1px solid #eee">' ||
        CASE WHEN v_story.category = 'local'
             THEN '<div style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#c2410c;font-weight:700;margin-bottom:6px">Africa</div>'
             ELSE '' END ||
        '<a href="' || v_story.url || '" style="font-size:17px;font-weight:700;color:#111;text-decoration:none;line-height:1.3">' ||
          v_story.title || '</a>' ||
        CASE WHEN coalesce(v_story.summary,'') <> ''
             THEN '<p style="font-size:14px;color:#555;line-height:1.55;margin:8px 0 0">' || v_story.summary || '</p>'
             ELSE '' END ||
        CASE WHEN v_cards <> ''
             THEN '<p style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#888;margin:18px 0 6px">Kit for this</p>'
                  || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' || v_cards || '</tr></table>'
             ELSE '' END ||
      '</div>';
  END LOOP;

  IF v_count = 0 THEN
    RAISE NOTICE 'build_ai_pulse_digest: no stories in the last % days, nothing drafted', p_days;
    RETURN NULL;
  END IF;

  -- The subject line is the week's lead headline, truncated on a word boundary.
  -- Real headlines out-open "Newsletter #14" every time, and these are already
  -- written by working journalists.
  v_subject := 'AI Pulse: ' || left(v_lead, 60) || CASE WHEN length(v_lead) > 60 THEN '…' ELSE '' END;

  INSERT INTO public.newsletter_campaigns (subject, preview_text, body_html, status)
  VALUES (
    v_subject,
    left(coalesce(v_lead,'This week in African AI'), 120),
    '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px">'
      || '<div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#888;font-weight:700">AI Smart Store</div>'
      || '<h1 style="font-size:24px;margin:6px 0 4px">AI Pulse Weekly</h1>'
      || '<p style="font-size:13px;color:#777;margin:0 0 28px">'
      || 'The AI stories that actually matter in South Africa — and the kit behind them.</p>'
      || v_html
      || '<p style="font-size:12px;color:#999;margin-top:28px">You are receiving this because you subscribed at aismartstore.co.za.</p>'
      || '</div>',
    'draft'
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;


--
-- Name: build_ai_pulse_digest(integer, integer, numeric, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.build_ai_pulse_digest(p_stories integer DEFAULT 5, p_min_stories integer DEFAULT 3, p_min_score numeric DEFAULT 55, p_max_per_source integer DEFAULT 2) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  v_site  text := 'https://aismartstore.co.za';
  -- Served from /public, so the filename is stable forever. An asset imported
  -- through the bundler gets a content hash in its name and changes on every
  -- rebuild, which would silently break the logo in every email already sent.
  v_logo  text := 'https://aismartstore.co.za/logo.png';
  v_story record; v_prod record;
  v_html text := ''; v_cards text;
  v_lead text; v_count int := 0; v_id uuid;
  v_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  FOR v_story IN
    SELECT * FROM (
      SELECT c.*,
             row_number() OVER (PARTITION BY c.source ORDER BY c.score DESC, c.published_at DESC) AS src_rank
        FROM public.ai_pulse_digest_candidates c
       WHERE c.score >= p_min_score
    ) r
    WHERE r.src_rank <= p_max_per_source
    ORDER BY r.score DESC, r.published_at DESC
    LIMIT p_stories
  LOOP
    v_count := v_count + 1;
    v_ids := v_ids || v_story.id;
    IF v_lead IS NULL THEN v_lead := public.decode_html_entities(v_story.title); END IF;

    v_cards := '';
    FOR v_prod IN
      SELECT p.id, p.name, p.price, p.images[1] AS image
        FROM public.products p
       WHERE p.is_active AND p.audience = 'residential' AND p.in_stock
         AND p.category = ANY (public.ai_pulse_story_categories(v_story.title || ' ' || coalesce(v_story.summary,'')))
         AND public.merch_is_home_eligible(p.category, p.name, p.price, p.images, p.is_ai_product)
       ORDER BY (public.score_home_product(p.category, p.name, p.brand, p.price, p.in_stock,
                   p.stock_quantity, p.images, p.is_ai_product, 0)->>'score')::numeric DESC
       LIMIT 2
    LOOP
      v_cards := v_cards ||
        '<td style="padding:8px;vertical-align:top;width:50%">' ||
          '<a href="' || v_site || '/product/' || v_prod.id ||
             '?utm_source=newsletter&utm_medium=email&utm_campaign=ai_pulse_daily" style="text-decoration:none;color:#111">' ||
            '<img src="' || coalesce(v_prod.image,'') || '" width="120" height="120" style="display:block;object-fit:contain;background:#fff;border:1px solid #eee;border-radius:10px" alt="">' ||
            '<div style="font-size:13px;font-weight:600;margin-top:8px;line-height:1.35;color:#111">' || left(coalesce(v_prod.name,''),70) || '</div>' ||
            '<div style="font-size:15px;font-weight:800;margin-top:4px;color:#7c3aed">R' || to_char(round(v_prod.price),'FM999G999') || '</div>' ||
          '</a></td>';
    END LOOP;

    v_html := v_html ||
      '<div style="margin:0 0 26px;padding:0 0 24px;border-bottom:1px solid #ececf1">' ||
        CASE WHEN v_story.country IS NOT NULL
             THEN '<div style="display:inline-block;font-size:10px;letter-spacing:.14em;text-transform:uppercase;font-weight:800;' ||
                  'color:#fff;background:linear-gradient(135deg,#06b6d4,#7c3aed);padding:4px 10px;border-radius:999px;margin-bottom:10px">'
                  || v_story.country || '</div>'
             ELSE '' END ||
        '<a href="' || v_story.url || '" style="display:block;font-size:18px;font-weight:800;color:#12121a;text-decoration:none;line-height:1.32">'
          || v_story.title || '</a>' ||
        CASE WHEN coalesce(v_story.summary,'') <> ''
             THEN '<p style="font-size:14px;color:#55555f;line-height:1.6;margin:9px 0 0">' || v_story.summary || '</p>' ELSE '' END ||
        CASE WHEN v_cards <> ''
             THEN '<p style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#9b9baa;font-weight:700;margin:20px 0 6px">Kit for this</p>'
                  || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' || v_cards || '</tr></table>'
             ELSE '' END ||
      '</div>';
  END LOOP;

  IF v_count < p_min_stories THEN
    RAISE NOTICE 'build_ai_pulse_digest: only % qualifying unsent stories (need %), nothing drafted', v_count, p_min_stories;
    RETURN NULL;
  END IF;

  INSERT INTO public.newsletter_campaigns (subject, preview_text, body_html, status)
  VALUES (
    -- Decoded, because a subject line is plain text. This is the fix for
    -- "Nigeria&#8217;s" appearing verbatim in the inbox.
    'AI Pulse: ' || left(v_lead, 60) || CASE WHEN length(v_lead) > 60 THEN '...' ELSE '' END,
    left(v_lead, 120),
      '<div style="background:#f6f6f9;padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Roboto,Helvetica,Arial,sans-serif">'
      || '<div style="max-width:640px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(18,18,26,.08)">'
      -- Brand bar: the gradient the whole site is built on, with the real mark.
      || '<div style="background:linear-gradient(135deg,#06b6d4 0%,#7c3aed 50%,#d946ef 100%);padding:22px 28px">'
        || '<table role="presentation" cellpadding="0" cellspacing="0"><tr>'
          || '<td style="vertical-align:middle;padding-right:10px">'
            || '<img src="' || v_logo || '" width="34" height="34" alt="AI Smart Store"'
            || ' style="display:block;width:34px;height:34px;object-fit:contain">'
          || '</td>'
          || '<td style="vertical-align:middle">'
            || '<div style="font-size:17px;font-weight:800;color:#fff;letter-spacing:-.01em">AI Smart Store</div>'
          || '</td>'
        || '</tr></table>'
      || '</div>'
      || '<div style="padding:28px">'
        || '<h1 style="font-size:26px;margin:0 0 6px;color:#12121a;letter-spacing:-.02em">AI Pulse</h1>'
        || '<p style="font-size:13px;color:#77778a;margin:0 0 26px">The AI stories that actually matter in South Africa — and the kit behind them.</p>'
        || v_html
        || '<a href="' || v_site || '/products?utm_source=newsletter&utm_medium=email&utm_campaign=ai_pulse_daily"'
        || ' style="display:inline-block;background:linear-gradient(135deg,#06b6d4,#7c3aed);color:#fff;font-weight:700;'
        || 'font-size:14px;text-decoration:none;padding:13px 26px;border-radius:999px;margin-top:6px">Shop the catalogue</a>'
      || '</div>'
      || '<div style="padding:18px 28px;background:#fafafc;border-top:1px solid #ececf1">'
        || '<p style="font-size:11px;color:#9b9baa;margin:0;line-height:1.6">'
        || 'You are receiving this because you subscribed at aismartstore.co.za.<br>'
        || 'AI Smart Store · Gqeberha, Eastern Cape · Proudly South African</p>'
      || '</div>'
      || '</div></div>',
    'draft'
  ) RETURNING id INTO v_id;

  INSERT INTO public.newsletter_story_sends (item_id, campaign_id)
  SELECT unnest(v_ids), v_id
  ON CONFLICT (item_id) DO NOTHING;

  RETURN v_id;
END $$;


--
-- Name: classify_product_category(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.classify_product_category(p_name text, p_category text DEFAULT NULL::text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public', 'pg_temp'
    AS $_$
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
$_$;


--
-- Name: clean_feed_text(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.clean_feed_text(p_text text) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT nullif(btrim(regexp_replace(
    replace(
      public.decode_feed_entities(
        regexp_replace(
          replace(replace(coalesce(p_text,''), '<![CDATA[', ''), ']]>', ''),
          '<[^>]*?>', '', 'g')
      ),
    '&amp;', '&'),
    '\s+', ' ', 'g')), '');
$$;


--
-- Name: deactivate_blocked_products(); Type: PROCEDURE; Schema: public; Owner: -
--

CREATE PROCEDURE public.deactivate_blocked_products()
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  affected INT;
BEGIN
  LOOP
    UPDATE public.products
    SET is_active = false
    WHERE ctid IN (
      SELECT p.ctid FROM public.products p
      JOIN public.image_blocklist b ON b.url = p.images[1]
      WHERE p.is_active
      LIMIT 2000
    );
    GET DIAGNOSTICS affected = ROW_COUNT;
    COMMIT;
    EXIT WHEN affected = 0;
  END LOOP;
END;
$$;


--
-- Name: deactivate_blocked_products_batch(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.deactivate_blocked_products_batch(batch_size integer DEFAULT 1000) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE affected INT;
BEGIN
  UPDATE public.products
  SET is_active = false
  WHERE ctid IN (
    SELECT p.ctid FROM public.products p
    JOIN public.image_blocklist b ON b.url = p.images[1]
    WHERE p.is_active
    LIMIT batch_size
  );
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;


--
-- Name: decode_feed_entities(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.decode_feed_entities(p_text text) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT CASE WHEN p_text IS NULL THEN NULL ELSE
    replace(replace(replace(replace(replace(replace(replace(replace(replace(
    replace(replace(replace(replace(replace(replace(
      p_text,
      '&#8217;', ''''), '&#8216;', ''''), '&#8220;', '"'), '&#8221;', '"'),
      '&#8211;', '-'),  '&#8212;', '-'),  '&#124;', '|'),   '&#039;', ''''),
      '&#38;', '&'),    '&hellip;', '...'), '&nbsp;', ' '), '&quot;', '"'),
      '&apos;', ''''),  '&lt;', '<'),      '&gt;', '>')
  END;
$$;


--
-- Name: decode_html_entities(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.decode_html_entities(p_text text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT CASE WHEN p_text IS NULL THEN NULL ELSE
    -- &amp; is unescaped LAST. Doing it first would turn "&amp;#8217;" into
    -- "&#8217;" and then into an apostrophe, silently changing text that was
    -- correctly double-escaped to begin with.
    replace(
      replace(
        replace(
          replace(
            replace(
              replace(
                replace(
                  replace(
                    replace(
                      replace(
                        replace(
                          replace(
                            replace(p_text, '&#8217;', ''''),
                          '&#8216;', ''''),
                        '&#8220;', '"'),
                      '&#8221;', '"'),
                    '&#8211;', '-'),
                  '&#8212;', '—'),
                '&#8230;', '…'),
              '&rsquo;', ''''),
            '&lsquo;', ''''),
          '&ldquo;', '"'),
        '&rdquo;', '"'),
      '&nbsp;', ' '),
    '&amp;', '&')
  END;
$$;


--
-- Name: delete_email(text, bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_email(queue_name text, message_id bigint) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pgmq', 'pg_temp'
    AS $$
BEGIN
  RETURN pgmq.delete(queue_name, message_id);
EXCEPTION WHEN undefined_table THEN
  RETURN FALSE;
END;
$$;


--
-- Name: dispatch_ai_pulse_digest(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.dispatch_ai_pulse_digest() RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_campaign uuid;
  v_secret   text;
  v_url      text;
BEGIN
  v_campaign := public.build_ai_pulse_digest();

  -- A quiet news day drafts nothing, and that is a designed outcome rather
  -- than a failure: six subscribers forgive silence, they do not forgive a
  -- padded digest. Nothing to send, nothing to report.
  IF v_campaign IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets WHERE name = 'internal_cron_secret';

  IF v_secret IS NULL THEN
    -- Loud, because the symptom otherwise is silence -- exactly the failure
    -- being fixed here. The draft survives and can be sent by hand.
    INSERT INTO public.automation_events (source, event_type, status, error_message, payload)
    VALUES ('ai-pulse-digest', 'digest.dispatch_blocked', 'error',
            'internal_cron_secret missing from vault; digest drafted but not sent.',
            jsonb_build_object('campaign_id', v_campaign));
    RETURN v_campaign;
  END IF;

  SELECT 'https://' || (SELECT value FROM public.store_settings WHERE key = 'supabase_project_ref')
         || '.supabase.co/functions/v1/send-newsletter-campaign'
    INTO v_url;
  IF v_url IS NULL OR v_url LIKE 'https://.%' THEN
    v_url := 'https://xwiqubcilptxzvdigsmp.supabase.co/functions/v1/send-newsletter-campaign';
  END IF;

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-secret', v_secret
    ),
    body := jsonb_build_object('campaign_id', v_campaign)
  );

  -- net.http_post only queues the request; the HTTP result lands in
  -- net._http_response, not here. So this records that dispatch was attempted,
  -- and send-newsletter-campaign records what actually happened to the mail.
  -- The campaign's own status is the source of truth for delivery.
  INSERT INTO public.automation_events (source, event_type, status, payload)
  VALUES ('ai-pulse-digest', 'digest.dispatched', 'success',
          jsonb_build_object('campaign_id', v_campaign));

  RETURN v_campaign;
END;
$$;


--
-- Name: enforce_image_blocklist(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_image_blocklist() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.images IS NULL OR array_length(NEW.images,1) IS NULL THEN
    NEW.is_active := false;
  ELSIF EXISTS (SELECT 1 FROM public.image_blocklist b WHERE b.url = NEW.images[1]) THEN
    NEW.is_active := false;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: engine_room_snapshot(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.engine_room_snapshot() RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT private.engine_room_snapshot_impl();
$$;


--
-- Name: enqueue_email(text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enqueue_email(queue_name text, payload jsonb) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pgmq', 'pg_temp'
    AS $$
BEGIN
  RETURN pgmq.send(queue_name, payload);
EXCEPTION WHEN undefined_table THEN
  PERFORM pgmq.create(queue_name);
  RETURN pgmq.send(queue_name, payload);
END;
$$;


--
-- Name: functions_base_url(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.functions_base_url() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT rtrim(value, '/') FROM public.store_settings WHERE key = 'functions_base_url'
$$;


--
-- Name: get_business_picks(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_business_picks(p_limit integer DEFAULT 8) RETURNS TABLE(id uuid, name text, description text, price numeric, category text, brand text, sku text, images text[], in_stock boolean, stock_quantity integer, is_ai_product boolean, created_at timestamp with time zone, expected_value numeric, reasons jsonb)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  WITH scored AS (
    SELECT p.*, public.score_business_product(
             p.price, pc.margin_percentage, p.in_stock, p.name, p.brand, p.category) AS j,
           row_number() OVER (
             PARTITION BY p.brand
             ORDER BY (public.score_business_product(
               p.price, pc.margin_percentage, p.in_stock, p.name, p.brand, p.category)->>'expected_value')::numeric DESC
           ) AS brand_rank
      FROM public.products p
      JOIN public.product_costs pc ON pc.product_id = p.id
     WHERE p.is_active
       AND p.audience = 'business'
       AND p.price > 0
       AND p.images IS NOT NULL AND p.images[1] IS NOT NULL
       AND p.images[1] NOT ILIKE '%placeholder%'
  )
  SELECT id, name, description, price, category, brand, sku, images, in_stock,
         stock_quantity, is_ai_product, created_at,
         (j->>'expected_value')::numeric, j->'reasons'
    FROM scored
   -- Max 3 per brand: 831 of the business lines are HPE, and an all-HPE page
   -- reads as a distributor dump rather than a curated offer.
   WHERE brand_rank <= 3
   ORDER BY (j->>'expected_value')::numeric DESC
   LIMIT greatest(1, least(coalesce(p_limit, 8), 48));
$$;


--
-- Name: get_compliance_pack(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_compliance_pack(_quote_id uuid, _email text) RETURNS SETOF public.compliance_documents
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  RETURN QUERY SELECT * FROM private.get_compliance_pack_impl(_quote_id, _email, auth.uid());
END;
$$;


--
-- Name: get_home_showcase(text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_home_showcase(p_slot text, p_limit integer DEFAULT 8) RETURNS TABLE(id uuid, name text, description text, price numeric, category text, brand text, sku text, images text[], in_stock boolean, stock_quantity integer, is_ai_product boolean, specifications jsonb, created_at timestamp with time zone, score numeric, reasons jsonb, rank integer)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
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


--
-- Name: get_newsletter_subscriber_count(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_newsletter_subscriber_count() RETURNS bigint
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  SELECT private.get_newsletter_subscriber_count_impl();
$$;


--
-- Name: get_product_admin_view(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_product_admin_view() RETURNS TABLE(id uuid, name text, cost_price numeric, selling_price numeric, margin_percentage numeric, axiz_product_id text, last_synced_at timestamp with time zone)
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin role required';
  END IF;
  RETURN QUERY
    SELECT p.id, p.name, p.cost_price, p.selling_price, p.margin_percentage,
           p.axiz_product_id, p.last_synced_at
    FROM public.products p;
END;
$$;


--
-- Name: get_product_facets(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_product_facets() RETURNS TABLE(facet_type text, facet_value text, product_count bigint)
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT c.facet_type, c.facet_value, c.product_count
  FROM public.product_facets_cache c
  ORDER BY c.facet_type ASC, c.product_count DESC;
$$;


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email, name, phone, customer_type, id_number, company_name, vat_number)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'phone',
    COALESCE(NEW.raw_user_meta_data->>'customer_type', 'residential'),
    NEW.raw_user_meta_data->>'id_number',
    NEW.raw_user_meta_data->>'company_name',
    NEW.raw_user_meta_data->>'vat_number'
  );
  RETURN NEW;
END;
$$;


--
-- Name: has_role(uuid, public.app_role); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$$;


--
-- Name: invoke_edge_function(text, jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.invoke_edge_function(fn_name text, body jsonb DEFAULT '{}'::jsonb, auth_mode text DEFAULT 'service'::text) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_base    text := public.functions_base_url();
  v_headers jsonb := jsonb_build_object('Content-Type', 'application/json');
  v_secret  text;
BEGIN
  IF v_base IS NULL OR v_base = '' THEN
    RAISE EXCEPTION 'invoke_edge_function: store_settings.functions_base_url is not set';
  END IF;

  IF auth_mode = 'service' THEN
    SELECT decrypted_secret INTO v_secret
      FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key';
    IF v_secret IS NULL THEN
      RAISE EXCEPTION 'invoke_edge_function(%): vault secret email_queue_service_role_key is missing', fn_name;
    END IF;
    v_headers := v_headers || jsonb_build_object('Authorization', 'Bearer ' || v_secret);

  ELSIF auth_mode = 'internal' THEN
    SELECT decrypted_secret INTO v_secret
      FROM vault.decrypted_secrets WHERE name = 'internal_cron_secret';
    IF v_secret IS NULL THEN
      RAISE EXCEPTION 'invoke_edge_function(%): vault secret internal_cron_secret is missing', fn_name;
    END IF;
    v_headers := v_headers || jsonb_build_object('x-internal-secret', v_secret);

  ELSIF auth_mode <> 'none' THEN
    RAISE EXCEPTION 'invoke_edge_function: unknown auth_mode %', auth_mode;
  END IF;

  RETURN net.http_post(
    url     := v_base || '/' || fn_name,
    headers := v_headers,
    body    := body
  );
END $$;


--
-- Name: log_order_changes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_order_changes() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.order_audit_log(order_id, actor_id, event_type, to_value, metadata)
    VALUES (NEW.id, v_actor, 'order_created', COALESCE(NEW.status, NEW.order_status::text, 'pending'),
            jsonb_build_object('total', NEW.total_amount, 'customer', NEW.customer_email));
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.order_audit_log(order_id, actor_id, event_type, from_value, to_value)
    VALUES (NEW.id, v_actor, 'status_changed', OLD.status, NEW.status);
  END IF;
  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
    INSERT INTO public.order_audit_log(order_id, actor_id, event_type, from_value, to_value)
    VALUES (NEW.id, v_actor, 'payment_status_changed', OLD.payment_status, NEW.payment_status);
  END IF;
  IF NEW.tracking_number IS DISTINCT FROM OLD.tracking_number THEN
    INSERT INTO public.order_audit_log(order_id, actor_id, event_type, from_value, to_value)
    VALUES (NEW.id, v_actor, 'tracking_updated', OLD.tracking_number, NEW.tracking_number);
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: log_quote_request_submitted(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_quote_request_submitted() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  INSERT INTO public.compliance_access_log(event_type, quote_request_id, email, actor_id, metadata)
  VALUES ('quote_submitted', NEW.id, NEW.email, auth.uid(),
          jsonb_build_object('organisation', NEW.organisation_name, 'contact_name', NEW.contact_name));
  RETURN NEW;
END $$;


--
-- Name: merch_availability(boolean, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.merch_availability(p_in_stock boolean, p_stock_quantity integer) RETURNS numeric
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT CASE
    WHEN NOT coalesce(p_in_stock, false)     THEN  20
    WHEN p_stock_quantity IS NULL            THEN  82   -- flag says yes, feed gave no depth
    WHEN p_stock_quantity <= 0               THEN  30   -- flag and quantity disagree
    WHEN p_stock_quantity < 5                THEN  88   -- real, but thin
    ELSE                                            100
  END::numeric;
$$;


--
-- Name: merch_brand_trust(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.merch_brand_trust(p_brand text) RETURNS numeric
    LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
    SET search_path TO 'public', 'pg_temp'
    AS $_$
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
END $_$;


--
-- Name: merch_demand_tier(text, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.merch_demand_tier(p_category text, p_name text, p_is_ai boolean DEFAULT false) RETURNS numeric
    LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
    SET search_path TO 'public', 'pg_temp'
    AS $$
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


--
-- Name: merch_is_home_eligible(text, text, numeric, text[], boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.merch_is_home_eligible(p_category text, p_name text, p_price numeric, p_images text[], p_is_ai boolean DEFAULT false) RETURNS boolean
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public'
    AS $$
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


--
-- Name: merch_media_quality(text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.merch_media_quality(p_images text[]) RETURNS numeric
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    SET search_path TO 'public', 'pg_temp'
    AS $$
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


--
-- Name: merch_name_quality(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.merch_name_quality(p_name text) RETURNS numeric
    LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
    SET search_path TO 'public', 'pg_temp'
    AS $$
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


--
-- Name: merch_norm(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.merch_norm(p_text text) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT regexp_replace(lower(coalesce(p_text, '')), '\s+', ' ', 'g');
$$;


--
-- Name: merch_price_fit(numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.merch_price_fit(p_price numeric) RETURNS numeric
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    SET search_path TO 'public', 'pg_temp'
    AS $$
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


--
-- Name: merch_setting(text, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.merch_setting(p_key text, p_default numeric) RETURNS numeric
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public'
    AS $$
DECLARE v text;
BEGIN
  SELECT value INTO v FROM public.store_settings WHERE key = p_key;
  IF v IS NULL OR btrim(v) = '' THEN RETURN p_default; END IF;
  RETURN btrim(v)::numeric;
EXCEPTION WHEN others THEN
  RETURN p_default;
END $$;


--
-- Name: merch_signal_score(numeric, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.merch_signal_score(p_paid_units numeric, p_wishlist_saves numeric) RETURNS numeric
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT least(100, 34 * ln(1
    + greatest(0, coalesce(p_paid_units, 0)) * 3
    + greatest(0, coalesce(p_wishlist_saves, 0))))::numeric;
$$;


--
-- Name: move_to_dlq(text, text, bigint, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.move_to_dlq(source_queue text, dlq_name text, message_id bigint, payload jsonb) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pgmq', 'pg_temp'
    AS $$
DECLARE new_id BIGINT;
BEGIN
  SELECT pgmq.send(dlq_name, payload) INTO new_id;
  PERFORM pgmq.delete(source_queue, message_id);
  RETURN new_id;
EXCEPTION WHEN undefined_table THEN
  BEGIN
    PERFORM pgmq.create(dlq_name);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  SELECT pgmq.send(dlq_name, payload) INTO new_id;
  BEGIN
    PERFORM pgmq.delete(source_queue, message_id);
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;
  RETURN new_id;
END;
$$;


--
-- Name: products_set_category(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.products_set_category() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  NEW.category := public.classify_product_category(NEW.name, NEW.category);
  RETURN NEW;
END;
$$;


--
-- Name: quarantine_mispriced_products(boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.quarantine_mispriced_products(dry_run boolean DEFAULT false) RETURNS TABLE(product_id uuid, name text, brand text, category text, price numeric, reason text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    SET statement_timeout TO '120s'
    AS $$
DECLARE
  v_floor numeric := COALESCE(
    (SELECT value::numeric FROM store_settings WHERE key = 'min_sellable_price'), 50);
BEGIN
  RETURN QUERY
  WITH flagged AS (
    SELECT p.id, p.name, p.brand, p.category, p.price,
           format('below_min_sellable_price (R%s < R%s)', p.price, v_floor) AS reason
    FROM products p
    WHERE p.is_active AND p.price < v_floor
  ),
  deactivated AS (
    UPDATE products p
       SET is_active = false
      FROM flagged f
     WHERE p.id = f.id AND NOT dry_run
    RETURNING p.id
  ),
  logged AS (
    INSERT INTO automation_events (source, event_type, status, error_message, payload)
    SELECT 'price-sanity',
           'product.quarantined',
           CASE WHEN dry_run THEN 'skipped' ELSE 'success' END,
           f.reason,
           jsonb_build_object(
             'product_id', f.id, 'sku_name', f.name, 'brand', f.brand,
             'category', f.category, 'price', f.price, 'dry_run', dry_run
           )
    FROM flagged f
    RETURNING 1
  )
  SELECT f.id, f.name, f.brand, f.category, f.price, f.reason
  FROM flagged f
  -- Forces the data-modifying CTEs to run even when the caller ignores rows.
  WHERE (SELECT count(*) FROM deactivated) >= 0
    AND (SELECT count(*) FROM logged) >= 0
  ORDER BY f.price;
END;
$$;


--
-- Name: read_email_batch(text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.read_email_batch(queue_name text, batch_size integer, vt integer) RETURNS TABLE(msg_id bigint, read_ct integer, message jsonb)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pgmq', 'pg_temp'
    AS $$
BEGIN
  RETURN QUERY SELECT r.msg_id, r.read_ct, r.message FROM pgmq.read(queue_name, vt, batch_size) r;
EXCEPTION WHEN undefined_table THEN
  PERFORM pgmq.create(queue_name);
  RETURN;
END;
$$;


--
-- Name: recategorize_batch(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recategorize_batch(batch_size integer DEFAULT 3000) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    SET statement_timeout TO '120s'
    AS $$
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
$$;


--
-- Name: record_payment_event(text, text, uuid, text, text, text, numeric, numeric, numeric, boolean, text, boolean, jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_payment_event(p_provider text, p_provider_payment_id text, p_order_id uuid, p_event_type text, p_payment_status text, p_outcome text, p_amount_gross numeric DEFAULT NULL::numeric, p_amount_fee numeric DEFAULT NULL::numeric, p_amount_net numeric DEFAULT NULL::numeric, p_sandbox boolean DEFAULT false, p_source_ip text DEFAULT NULL::text, p_signature_valid boolean DEFAULT NULL::boolean, p_raw jsonb DEFAULT NULL::jsonb, p_error text DEFAULT NULL::text) RETURNS TABLE(event_id uuid, is_first boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.payment_events (
    provider, provider_payment_id, order_id, event_type, payment_status,
    amount_gross, amount_fee, amount_net, outcome, sandbox, source_ip,
    signature_valid, raw_payload, error_message
  )
  VALUES (
    p_provider, p_provider_payment_id, p_order_id, p_event_type, p_payment_status,
    p_amount_gross, p_amount_fee, p_amount_net, p_outcome, p_sandbox, p_source_ip,
    p_signature_valid, p_raw, p_error
  )
  ON CONFLICT (provider, provider_payment_id, payment_status)
    WHERE outcome = 'processed' AND provider_payment_id IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT v_id, true;
    RETURN;
  END IF;

  -- Lost the race (or a retry of an already-processed notification). Keep the
  -- attempt in the audit trail, but tell the caller to do nothing further.
  INSERT INTO public.payment_events (
    provider, provider_payment_id, order_id, event_type, payment_status,
    amount_gross, amount_fee, amount_net, outcome, sandbox, source_ip,
    signature_valid, raw_payload, error_message
  )
  VALUES (
    p_provider, p_provider_payment_id, p_order_id, p_event_type, p_payment_status,
    p_amount_gross, p_amount_fee, p_amount_net, 'duplicate_ignored', p_sandbox, p_source_ip,
    p_signature_valid, p_raw,
    format('Duplicate %s notification for pf_payment_id=%s; already processed.',
           p_payment_status, p_provider_payment_id)
  )
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, false;
END;
$$;


--
-- Name: refresh_home_showcase(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_home_showcase() RETURNS TABLE(slot text, filled integer)
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
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


--
-- Name: refresh_product_facets_cache(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_product_facets_cache() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    SET statement_timeout TO '120s'
    AS $$
DECLARE n integer;
BEGIN
  TRUNCATE public.product_facets_cache;
  INSERT INTO public.product_facets_cache (facet_type, facet_value, product_count)
  SELECT 'category', initcap(lower(category)), count(*)::bigint
    FROM public.products
    WHERE is_active = true AND category IS NOT NULL AND btrim(category) <> ''
    GROUP BY initcap(lower(category))
  UNION ALL
  SELECT 'brand', initcap(lower(brand)), count(*)::bigint
    FROM public.products
    WHERE is_active = true AND brand IS NOT NULL AND btrim(brand) <> ''
    GROUP BY initcap(lower(brand));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;


--
-- Name: retention_sweep(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.retention_sweep(p_max_rows_per_table integer DEFAULT 20000) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $_$
DECLARE
  pol      record;
  deleted  bigint;
  result   jsonb := '{}'::jsonb;
  inert    text[] := '{}';
BEGIN
  FOR pol IN
    SELECT p.table_name, p.timestamp_column, p.retention_days
    FROM public.data_retention_policy p
    WHERE p.enabled
    ORDER BY p.table_name
  LOOP
    -- A policy naming a table or column that does not exist is reported, not
    -- skipped in silence. Silently skipping is what turns a typo into a table
    -- that grows without limit while a document says it is being trimmed.
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = pol.timestamp_column AND NOT a.attisdropped
      WHERE c.relname = pol.table_name AND c.relkind = 'r' AND n.nspname = 'public'
    ) THEN
      inert := inert || pol.table_name;
      CONTINUE;
    END IF;

    EXECUTE format(
      'DELETE FROM public.%I WHERE ctid IN (
         SELECT ctid FROM public.%I WHERE %I < now() - ($1 || '' days'')::interval LIMIT $2
       )',
      pol.table_name, pol.table_name, pol.timestamp_column
    ) USING pol.retention_days, p_max_rows_per_table;

    GET DIAGNOSTICS deleted = ROW_COUNT;
    IF deleted > 0 THEN
      result := result || jsonb_build_object(pol.table_name, deleted);
    END IF;
  END LOOP;

  IF array_length(inert, 1) > 0 THEN
    result := result || jsonb_build_object('_inert_policies', to_jsonb(inert));
    INSERT INTO public.automation_events (source, event_type, status, error_message, payload)
    VALUES ('retention-sweep', 'retention.policy_inert', 'error',
            'Retention policy rows name a table or timestamp column that does not exist, so they delete nothing.',
            jsonb_build_object('tables', to_jsonb(inert)));
  END IF;

  -- Only writes an event when something was actually deleted. A daily row
  -- saying "deleted nothing" is 365 rows a year in the very table this
  -- function exists to keep small.
  IF result - '_inert_policies' <> '{}'::jsonb THEN
    INSERT INTO public.automation_events (source, event_type, status, payload)
    VALUES ('retention-sweep', 'retention.swept', 'success', result - '_inert_policies');
  END IF;

  RETURN result;
END;
$_$;


--
-- Name: rl_sweep(interval); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rl_sweep(p_older_than interval DEFAULT '2 days'::interval) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE v_n integer;
BEGIN
  DELETE FROM public.rate_limit_buckets WHERE last_refill < now() - p_older_than;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;


--
-- Name: rl_take(text, numeric, numeric, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rl_take(p_key text, p_capacity numeric, p_refill_per_min numeric, p_cost numeric DEFAULT 1) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_tokens numeric;
  v_now    timestamptz := clock_timestamp();
BEGIN
  -- A request that could never fit is a caller bug, not a rate-limit decision.
  -- Say so distinctly rather than reporting an ordinary refusal, otherwise it
  -- looks like load and gets "fixed" by raising the wrong number.
  IF p_cost > p_capacity THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'cost_exceeds_capacity',
                              'remaining', 0, 'retry_after_s', 0);
  END IF;

  -- Refill and spend in a single statement. The ON CONFLICT path takes a row
  -- lock, so two simultaneous requests for the same key cannot both read the
  -- same "before" balance and both be allowed -- which is precisely the race a
  -- burst attack produces, and precisely the one a read-then-write version of
  -- this function would lose.
  INSERT INTO public.rate_limit_buckets AS b (bucket_key, tokens, last_refill)
  VALUES (p_key, p_capacity - p_cost, v_now)
  ON CONFLICT (bucket_key) DO UPDATE
     SET tokens = least(
                    p_capacity,
                    b.tokens + (extract(epoch FROM (v_now - b.last_refill)) / 60.0) * p_refill_per_min
                  ) - p_cost,
         last_refill = v_now
   WHERE least(
           p_capacity,
           b.tokens + (extract(epoch FROM (v_now - b.last_refill)) / 60.0) * p_refill_per_min
         ) >= p_cost
  RETURNING b.tokens INTO v_tokens;

  IF FOUND THEN
    RETURN jsonb_build_object('allowed', true, 'remaining', round(v_tokens, 2), 'retry_after_s', 0);
  END IF;

  -- Refused. Report how long until one token is available so the caller can
  -- send a truthful Retry-After instead of inviting an immediate retry.
  SELECT b.tokens INTO v_tokens FROM public.rate_limit_buckets b WHERE b.bucket_key = p_key;
  RETURN jsonb_build_object(
    'allowed', false,
    'reason', 'rate_limited',
    'remaining', round(coalesce(v_tokens, 0), 2),
    'retry_after_s', ceil(greatest(0, p_cost - coalesce(v_tokens, 0)) / greatest(p_refill_per_min, 0.0001) * 60.0)
  );
END $$;


--
-- Name: score_business_product(numeric, numeric, boolean, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.score_business_product(p_price numeric, p_margin_pct numeric, p_in_stock boolean, p_name text, p_brand text, p_category text) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_pct    numeric := coalesce(nullif(p_margin_pct,0), 17);
  v_margin numeric := coalesce(p_price,0) * v_pct / 100.0;
  v_close  numeric := public.biz_close_rate(p_price, p_in_stock);
  v_rep    numeric := public.biz_repeat_factor(p_price);
  v_ev     numeric := round(v_margin * v_close * v_rep, 2);
  v_r      text[]  := ARRAY[]::text[];
BEGIN
  IF v_pct >= 20 THEN v_r := v_r || format('Strong %s%% margin', round(v_pct,1))::text;
  ELSIF v_pct < 10 THEN v_r := v_r || format('Thin %s%% margin', round(v_pct,1))::text; END IF;

  IF coalesce(p_in_stock,false) THEN v_r := v_r || 'In stock - no lead-time objection'::text;
  ELSE v_r := v_r || 'Backorder - lead time is the deal killer in B2B'::text; END IF;

  IF p_price < 5000 THEN v_r := v_r || 'Closes without a procurement process'::text;
  ELSIF p_price >= 500000 THEN v_r := v_r || 'Tender-scale: rarely closes from a web listing'::text; END IF;

  IF v_rep >= 4 THEN v_r := v_r || 'Re-order line - earns repeatedly, not once'::text; END IF;

  RETURN jsonb_build_object(
    'expected_value', v_ev, 'margin_rand', round(v_margin,2), 'margin_pct', round(v_pct,1),
    'close_rate', round(v_close,6), 'repeat_factor', round(v_rep,2), 'reasons', to_jsonb(v_r));
END $$;


--
-- Name: score_home_product(text, text, text, numeric, boolean, integer, text[], boolean, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.score_home_product(p_category text, p_name text, p_brand text, p_price numeric, p_in_stock boolean, p_stock_quantity integer, p_images text[], p_is_ai boolean DEFAULT false, p_signal numeric DEFAULT 0) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public'
    AS $$
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


--
-- Name: search_product_facets(text, text, text, boolean, boolean, numeric, numeric, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_product_facets(search_query text DEFAULT ''::text, filter_category text DEFAULT NULL::text, filter_brand text DEFAULT NULL::text, filter_ai_only boolean DEFAULT false, filter_in_stock_only boolean DEFAULT false, min_price numeric DEFAULT NULL::numeric, max_price numeric DEFAULT NULL::numeric, filter_audience text DEFAULT 'residential'::text) RETURNS TABLE(facet_type text, facet_value text, product_count bigint)
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  has_search boolean := btrim(coalesce(search_query, '')) <> '';
  ts_query   tsquery;
  v_audience text := lower(coalesce(filter_audience, 'residential'));
BEGIN
  IF has_search THEN
    ts_query := plainto_tsquery('english', search_query);
  END IF;

  RETURN QUERY
  WITH base AS (
    -- Audience + free-text search only. Everything else is layered per-scope
    -- below so each facet can relax exactly its own predicate.
    SELECT p.category, p.brand, p.is_ai_product, p.in_stock, p.price
    FROM public.products p
    WHERE p.is_active = true
      AND (v_audience = 'all' OR p.audience = v_audience)
      AND (
        NOT has_search
        OR p.search_vector @@ ts_query
        OR p.name % search_query
      )
  ),
  priced AS (
    SELECT * FROM base b
    WHERE (min_price IS NULL OR b.price >= min_price)
      AND (max_price IS NULL OR b.price <= max_price)
  ),
  -- Category counts: brand + toggles + price applied, category relaxed.
  cat_scope AS (
    SELECT * FROM priced b
    WHERE (filter_brand IS NULL OR lower(b.brand) = lower(filter_brand))
      AND (NOT filter_ai_only       OR b.is_ai_product = true)
      AND (NOT filter_in_stock_only OR b.in_stock = true)
  ),
  -- Brand counts: category + toggles + price applied, brand relaxed.
  brand_scope AS (
    SELECT * FROM priced b
    WHERE (filter_category IS NULL OR lower(b.category) = lower(filter_category))
      AND (NOT filter_ai_only       OR b.is_ai_product = true)
      AND (NOT filter_in_stock_only OR b.in_stock = true)
  ),
  -- Toggle counts: category + brand + price applied; each toggle relaxes
  -- itself but still respects the other toggle.
  toggle_scope AS (
    SELECT * FROM priced b
    WHERE (filter_category IS NULL OR lower(b.category) = lower(filter_category))
      AND (filter_brand    IS NULL OR lower(b.brand)    = lower(filter_brand))
  ),
  -- Price bounds: everything applied EXCEPT the price window itself, so the
  -- min/max hints describe the range the shopper could widen back out to.
  price_scope AS (
    SELECT * FROM base b
    WHERE (filter_category IS NULL OR lower(b.category) = lower(filter_category))
      AND (filter_brand    IS NULL OR lower(b.brand)    = lower(filter_brand))
      AND (NOT filter_ai_only       OR b.is_ai_product = true)
      AND (NOT filter_in_stock_only OR b.in_stock = true)
  )
  SELECT 'category'::text,
         mode() WITHIN GROUP (ORDER BY c.category)::text,
         count(*)::bigint
    FROM cat_scope c
   WHERE c.category IS NOT NULL AND btrim(c.category) <> ''
   GROUP BY lower(c.category)

  UNION ALL
  SELECT 'brand'::text,
         mode() WITHIN GROUP (ORDER BY b.brand)::text,
         count(*)::bigint
    FROM brand_scope b
   WHERE b.brand IS NOT NULL AND btrim(b.brand) <> ''
   GROUP BY lower(b.brand)

  UNION ALL
  SELECT 'toggle'::text, 'ai_ready'::text, count(*)::bigint
    FROM toggle_scope t
   WHERE t.is_ai_product = true
     AND (NOT filter_in_stock_only OR t.in_stock = true)

  UNION ALL
  SELECT 'toggle'::text, 'in_stock'::text, count(*)::bigint
    FROM toggle_scope t
   WHERE t.in_stock = true
     AND (NOT filter_ai_only OR t.is_ai_product = true)

  UNION ALL
  SELECT 'meta'::text, 'price_min'::text, floor(coalesce(min(p.price), 0))::bigint FROM price_scope p
  UNION ALL
  SELECT 'meta'::text, 'price_max'::text, ceil(coalesce(max(p.price), 0))::bigint  FROM price_scope p

  ORDER BY 1 ASC, 3 DESC, 2 ASC;
END;
$$;


--
-- Name: search_products(text, text, text, boolean, boolean, numeric, numeric, text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_products(search_query text DEFAULT ''::text, filter_category text DEFAULT NULL::text, filter_brand text DEFAULT NULL::text, filter_ai_only boolean DEFAULT false, filter_in_stock_only boolean DEFAULT false, min_price numeric DEFAULT NULL::numeric, max_price numeric DEFAULT NULL::numeric, sort_by text DEFAULT 'relevance'::text, page_number integer DEFAULT 0, page_size integer DEFAULT 24) RETURNS TABLE(id uuid, sku text, slug text, name text, description text, price numeric, category text, brand text, stock_quantity integer, in_stock boolean, images text[], is_ai_product boolean, total_count bigint)
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  has_search  boolean := btrim(coalesce(search_query, '')) <> '';
  ts_query    tsquery;
  v_sort      text := coalesce(sort_by, 'relevance');
BEGIN
  IF has_search THEN
    ts_query := plainto_tsquery('english', search_query);
  END IF;

  RETURN QUERY
    SELECT p.id, p.sku, p.slug, p.name, p.description, p.price,
           p.category, p.brand, p.stock_quantity, p.in_stock,
           p.images, p.is_ai_product,
           count(*) OVER() AS total_count
    FROM public.products p
    WHERE p.is_active = true
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
$$;


--
-- Name: search_products(text, text, text, boolean, boolean, numeric, numeric, text, integer, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_products(search_query text DEFAULT ''::text, filter_category text DEFAULT NULL::text, filter_brand text DEFAULT NULL::text, filter_ai_only boolean DEFAULT false, filter_in_stock_only boolean DEFAULT false, min_price numeric DEFAULT NULL::numeric, max_price numeric DEFAULT NULL::numeric, sort_by text DEFAULT 'relevance'::text, page_number integer DEFAULT 0, page_size integer DEFAULT 24, filter_audience text DEFAULT 'residential'::text) RETURNS TABLE(id uuid, sku text, slug text, name text, description text, price numeric, category text, brand text, stock_quantity integer, in_stock boolean, images text[], is_ai_product boolean, audience text, total_count bigint)
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  has_search  boolean := btrim(coalesce(search_query, '')) <> '';
  ts_query    tsquery;
  v_sort      text := coalesce(sort_by, 'relevance');
  v_audience  text := lower(coalesce(filter_audience, 'residential'));
BEGIN
  IF has_search THEN
    ts_query := plainto_tsquery('english', search_query);
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
$$;


--
-- Name: sec_log(text, text, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sec_log(p_kind text, p_severity text DEFAULT 'info'::text, p_actor text DEFAULT NULL::text, p_detail jsonb DEFAULT '{}'::jsonb) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  INSERT INTO public.security_events (kind, severity, actor, detail)
  VALUES (p_kind, coalesce(p_severity, 'info'), p_actor, coalesce(p_detail, '{}'::jsonb));
$$;


--
-- Name: set_newsletter_interests(uuid, text, text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_newsletter_interests(_subscriber_id uuid, _email text, _categories text[]) RETURNS boolean
    LANGUAGE sql
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT private.set_newsletter_interests_impl(_subscriber_id, _email, _categories);
$$;


--
-- Name: spend_guard(text, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.spend_guard(p_provider text, p_estimated_cost_zar numeric DEFAULT 0) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  c              public.spend_caps%ROWTYPE;
  v_spent_today  numeric := 0;
  v_spent_month  numeric := 0;
  v_calls_today  integer := 0;
  v_reason       text    := NULL;
BEGIN
  SELECT * INTO c FROM public.spend_caps WHERE provider = p_provider;

  -- An unknown provider is allowed, and says so. Failing closed here would mean
  -- that adding a new integration silently breaks it until someone remembers
  -- this table -- a guard that blocks legitimate new work gets switched off,
  -- and a guard that is switched off protects nothing.
  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', true, 'reason', 'no_cap_configured', 'provider', p_provider);
  END IF;

  IF NOT c.enabled THEN
    RETURN jsonb_build_object('allowed', true, 'reason', 'cap_disabled', 'provider', p_provider);
  END IF;

  SELECT coalesce(sum(cost_zar), 0), count(*)
    INTO v_spent_today, v_calls_today
    FROM public.spend_ledger
   WHERE provider = p_provider
     -- Africa/Johannesburg, not UTC. A cap that resets at 02:00 local time
     -- gives an attacker two fresh daily budgets inside one South African
     -- night, which is exactly when nobody is watching.
     AND occurred_at >= date_trunc('day', now() AT TIME ZONE 'Africa/Johannesburg')
                          AT TIME ZONE 'Africa/Johannesburg';

  SELECT coalesce(sum(cost_zar), 0)
    INTO v_spent_month
    FROM public.spend_ledger
   WHERE provider = p_provider
     AND occurred_at >= date_trunc('month', now() AT TIME ZONE 'Africa/Johannesburg')
                          AT TIME ZONE 'Africa/Johannesburg';

  IF c.daily_call_cap > 0 AND v_calls_today >= c.daily_call_cap THEN
    v_reason := 'daily_call_cap';
  ELSIF c.daily_cap_zar > 0 AND (v_spent_today + coalesce(p_estimated_cost_zar, 0)) > c.daily_cap_zar THEN
    v_reason := 'daily_rand_cap';
  ELSIF c.monthly_cap_zar > 0 AND (v_spent_month + coalesce(p_estimated_cost_zar, 0)) > c.monthly_cap_zar THEN
    v_reason := 'monthly_rand_cap';
  END IF;

  IF v_reason IS NOT NULL THEN
    PERFORM public.sec_log(
      'spend_cap_hit',
      CASE WHEN c.hard_stop THEN 'high' ELSE 'medium' END,
      p_provider,
      jsonb_build_object('reason', v_reason, 'spent_today', v_spent_today,
                         'spent_month', v_spent_month, 'calls_today', v_calls_today,
                         'hard_stop', c.hard_stop));
  END IF;

  RETURN jsonb_build_object(
    'allowed',      v_reason IS NULL OR NOT c.hard_stop,
    'blocked',      v_reason IS NOT NULL AND c.hard_stop,
    'reason',       coalesce(v_reason, 'ok'),
    'provider',     p_provider,
    'spent_today',  round(v_spent_today, 2),
    'spent_month',  round(v_spent_month, 2),
    'calls_today',  v_calls_today,
    'daily_cap',    c.daily_cap_zar,
    'monthly_cap',  c.monthly_cap_zar,
    'call_cap',     c.daily_call_cap);
END $$;


--
-- Name: spend_record(text, text, numeric, numeric, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.spend_record(p_provider text, p_source text, p_units numeric DEFAULT 1, p_cost_zar numeric DEFAULT 0, p_meta jsonb DEFAULT '{}'::jsonb) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  INSERT INTO public.spend_ledger (provider, source, units, cost_zar, meta)
  VALUES (p_provider, p_source, coalesce(p_units, 1), coalesce(p_cost_zar, 0), coalesce(p_meta, '{}'::jsonb));
$$;


--
-- Name: tg_threat_newsletter(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tg_threat_newsletter() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE v_bonus integer := 0;
BEGIN
  -- A newsletter signup has no field that should ever hold a sentence. A name
  -- longer than a long real name, or one containing a URL, is a form being
  -- filled by something that does not know what the field is for.
  IF length(coalesce(NEW.name,'')) > 60 THEN v_bonus := v_bonus + 35; END IF;
  IF coalesce(NEW.name,'') ~* '(https?://|www\.|\.(com|net|org|tk|ru|xyz)\y)' THEN v_bonus := v_bonus + 40; END IF;
  IF length(coalesce(NEW.name,'')) > 25
     AND coalesce(NEW.name,'') ~ '[[:space:]].*[[:space:]].*[[:space:]]' THEN
    v_bonus := v_bonus + 25;   -- four or more words in a "name"
  END IF;

  IF public.threat_gate('newsletter', NEW.email,
       concat_ws(' ', NEW.email, NEW.name, NEW.source),
       jsonb_build_object('email', NEW.email, 'name', NEW.name, 'source', NEW.source, 'bonus', v_bonus),
       v_bonus)
  THEN RETURN NEW; ELSE RETURN NULL; END IF;
END $$;


--
-- Name: tg_threat_quote(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tg_threat_quote() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF public.threat_gate('quote', NEW.email,
       concat_ws(' ', NEW.organisation_name, NEW.contact_name, NEW.email, NEW.phone, NEW.requirements),
       jsonb_build_object('organisation', NEW.organisation_name, 'contact_name', NEW.contact_name,
                          'email', NEW.email, 'phone', NEW.phone, 'requirements', NEW.requirements),
       0)
  THEN RETURN NEW; ELSE RETURN NULL; END IF;
END $$;


--
-- Name: threat_block(text, text, text, integer, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.threat_block(p_key text, p_reason text, p_category text, p_score integer, p_detail jsonb DEFAULT '{}'::jsonb) RETURNS timestamp with time zone
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_offences integer;
  v_until    timestamptz;
BEGIN
  SELECT offences INTO v_offences FROM public.threat_blocks WHERE block_key = p_key;
  v_offences := coalesce(v_offences, 0) + 1;

  -- Doubling, capped at a week. A first offence costs an hour, which a genuine
  -- misunderstanding survives -- the customer tries again after lunch. By the
  -- seventh it is a week, which no real person reaches by accident. Permanent
  -- blocks are deliberately not available: they outlive the campaign that
  -- caused them and turn into a mystery nobody can explain.
  v_until := now() + least(interval '7 days', make_interval(hours => power(2, v_offences - 1)::int));

  INSERT INTO public.threat_blocks AS b (block_key, reason, category, score, offences, blocked_at, expires_at, detail)
  VALUES (p_key, p_reason, p_category, p_score, v_offences, now(), v_until, p_detail)
  ON CONFLICT (block_key) DO UPDATE
     SET reason = excluded.reason, category = excluded.category, score = excluded.score,
         offences = excluded.offences, blocked_at = now(), expires_at = excluded.expires_at,
         detail = excluded.detail;

  PERFORM public.sec_log('threat_blocked', 'high', p_key,
    jsonb_build_object('reason', p_reason, 'category', p_category, 'score', p_score,
                       'offences', v_offences, 'until', v_until) || p_detail);
  RETURN v_until;
END $$;


--
-- Name: threat_gate(text, text, text, jsonb, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.threat_gate(p_surface text, p_email text, p_content text, p_detail jsonb DEFAULT '{}'::jsonb, p_bonus integer DEFAULT 0) RETURNS boolean
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_assess jsonb; v_score integer; v_cat text;
  v_domain text; v_key text; v_dkey text; v_recent integer; v_trusted boolean := false;
BEGIN
  v_key    := 'email:' || lower(coalesce(p_email, 'unknown'));
  v_domain := lower(split_part(coalesce(p_email, ''), '@', 2));
  v_dkey   := 'domain:' || v_domain;

  IF public.threat_is_blocked(v_key) OR (v_domain <> '' AND public.threat_is_blocked(v_dkey)) THEN
    PERFORM public.sec_log('threat_refused_blocked', 'medium', v_key,
      jsonb_build_object('surface', p_surface) || p_detail);
    RETURN false;
  END IF;

  -- Someone who has actually paid us is never auto-blocked on wording. A regex
  -- is not better evidence than a completed order.
  SELECT EXISTS (SELECT 1 FROM public.orders o
                  WHERE lower(o.customer_email) = lower(coalesce(p_email, ''))
                    AND o.payment_status = 'paid') INTO v_trusted;

  v_assess := public.threat_score(p_content);
  -- The caller's structural bonus. Vocabulary alone cannot see that a field is
  -- being misused: "SEO backlink guest post" scores 45, correctly short of
  -- blocking inside a requirements paragraph and obviously spam in a field
  -- meant to hold "Fernando". The surface knows its own shape, so the surface
  -- contributes that judgement.
  v_score  := least(100, (v_assess->>'score')::integer + greatest(0, coalesce(p_bonus, 0)));
  v_cat    := v_assess->>'category';
  IF v_cat = 'clean' AND coalesce(p_bonus, 0) > 0 THEN v_cat := 'bot'; END IF;

  -- Velocity. Content can be clean and the behaviour still obviously automated:
  -- a form filled six times in ten minutes from one address is a script, and
  -- each newsletter signup fires a welcome email that costs real money.
  SELECT count(*) INTO v_recent
    FROM public.security_events
   WHERE actor = v_key
     AND kind IN ('threat_seen','threat_blocked','threat_refused_blocked')
     AND created_at > now() - interval '10 minutes';
  IF v_recent >= 5 THEN v_score := greatest(v_score, 75); v_cat := 'bot'; END IF;

  IF v_score >= 70 AND NOT v_trusted THEN
    PERFORM public.threat_block(v_key, format('%s submission scored %s', p_surface, v_score),
                                v_cat, v_score, p_detail || jsonb_build_object('hits', v_assess->'hits'));
    -- A domain seen offending from three separate addresses is a campaign, not
    -- three unlucky people. Free providers are excluded: blocking gmail.com
    -- would take the customers with it.
    IF v_domain <> '' AND v_domain NOT IN
       ('gmail.com','yahoo.com','outlook.com','hotmail.com','icloud.com','live.com','webmail.co.za','telkomsa.net')
       AND (SELECT count(*) FROM public.threat_blocks
             WHERE block_key LIKE 'email:%@' || v_domain AND expires_at > now()) >= 3
    THEN
      PERFORM public.threat_block(v_dkey, 'three or more blocked senders on this domain',
                                  v_cat, v_score, jsonb_build_object('domain', v_domain));
    END IF;
    INSERT INTO public.threat_quarantine (surface, email, score, category, payload, hits)
    VALUES (p_surface, p_email, v_score, v_cat, p_detail, v_assess->'hits');
    RETURN false;
  END IF;

  IF v_score >= 40 THEN
    -- Allowed through, but on the record. This band is what makes the velocity
    -- check work, and what lets the owner watch a campaign build before
    -- anything is turned away.
    PERFORM public.sec_log('threat_seen', 'low', v_key,
      jsonb_build_object('surface', p_surface, 'score', v_score, 'category', v_cat,
                         'trusted_customer', v_trusted, 'hits', v_assess->'hits'));
  END IF;
  RETURN true;
END $$;


--
-- Name: threat_is_blocked(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.threat_is_blocked(p_key text) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (SELECT 1 FROM public.threat_blocks
                  WHERE block_key = p_key AND expires_at > now());
$$;


--
-- Name: threat_score(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.threat_score(p_text text) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_score  integer := 0;
  v_hits   jsonb   := '[]'::jsonb;
  v_cat    text    := 'clean';
  v_top    integer := 0;
  r        record;
  v_norm   text;
BEGIN
  IF p_text IS NULL OR btrim(p_text) = '' THEN
    RETURN jsonb_build_object('score', 0, 'category', 'clean', 'hits', '[]'::jsonb);
  END IF;

  -- Collapse the evasions that cost nothing to try before matching anything.
  -- Zero-width characters split a word so `v<200b>iagra` misses every pattern
  -- while rendering identically; runs of whitespace do the same job in plain
  -- sight. Stripping both means the signatures can stay readable instead of
  -- each one growing its own obfuscation handling.
  v_norm := lower(regexp_replace(
              regexp_replace(p_text, '[​-‍﻿­]', '', 'g'),
              '[[:space:]]+', ' ', 'g'));

  FOR r IN SELECT category, label, pattern, weight
             FROM public.threat_signatures WHERE enabled
  LOOP
    IF v_norm ~* r.pattern THEN
      v_score := v_score + r.weight;
      v_hits  := v_hits || jsonb_build_object('category', r.category, 'label', r.label, 'weight', r.weight);
      -- The reported category is whichever family landed the heaviest single
      -- hit, not the most frequent. Five weak spam matches should not relabel
      -- something whose real problem is a script tag.
      IF r.weight > v_top THEN v_top := r.weight; v_cat := r.category; END IF;
    END IF;
  END LOOP;

  -- Structural signals, which no vocabulary list catches.
  -- Mixed scripts in one word is the homograph attack: раypal with a Cyrillic
  -- 'а' is a different string that reads identically.
  IF v_norm ~ '[[:alpha:]]' AND v_norm ~ '[Ѐ-ӿͰ-Ͽ]' AND v_norm ~ '[a-z]' THEN
    v_score := v_score + 40;
    v_hits  := v_hits || jsonb_build_object('category','phishing','label','Mixed-script text','weight',40);
    IF 40 > v_top THEN v_top := 40; v_cat := 'phishing'; END IF;
  END IF;

  RETURN jsonb_build_object('score', least(v_score, 100), 'category', v_cat, 'hits', v_hits);
END $$;


--
-- Name: threat_summary(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.threat_summary() RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT jsonb_build_object(
    'active_blocks',  (SELECT count(*) FROM public.threat_blocks WHERE expires_at > now()),
    'blocked_24h',    (SELECT count(*) FROM public.security_events
                        WHERE kind = 'threat_blocked' AND created_at > now() - interval '24 hours'),
    'suspicious_24h', (SELECT count(*) FROM public.security_events
                        WHERE kind = 'threat_seen' AND created_at > now() - interval '24 hours'),
    'quarantined_24h',(SELECT count(*) FROM public.threat_quarantine
                        WHERE created_at > now() - interval '24 hours'),
    'by_category',    coalesce((SELECT jsonb_object_agg(category, n) FROM
                        (SELECT category, count(*) n FROM public.threat_blocks
                          WHERE expires_at > now() GROUP BY category) c), '{}'::jsonb),
    'blocks',         coalesce((SELECT jsonb_agg(jsonb_build_object(
                        'key', block_key, 'reason', reason, 'category', category, 'score', score,
                        'offences', offences, 'until', expires_at) ORDER BY blocked_at DESC)
                       FROM (SELECT * FROM public.threat_blocks WHERE expires_at > now()
                              ORDER BY blocked_at DESC LIMIT 25) b), '[]'::jsonb),
    'quarantine',     coalesce((SELECT jsonb_agg(jsonb_build_object(
                        'id', id, 'surface', surface, 'email', email, 'score', score,
                        'category', category, 'payload', payload, 'hits', hits, 'at', created_at)
                        ORDER BY created_at DESC)
                       FROM (SELECT * FROM public.threat_quarantine WHERE NOT released
                              ORDER BY created_at DESC LIMIT 25) q), '[]'::jsonb));
$$;


--
-- Name: threat_sweep(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.threat_sweep() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE v_n integer;
BEGIN
  DELETE FROM public.threat_blocks WHERE expires_at < now() - interval '7 days';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;


--
-- Name: threat_unblock(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.threat_unblock(p_key text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE v_n integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.threat_blocks WHERE block_key = p_key;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN
    PERFORM public.sec_log('threat_unblocked', 'medium', coalesce(auth.uid()::text, '?'),
                           jsonb_build_object('key', p_key));
  END IF;
  RETURN v_n > 0;
END $$;


--
-- Name: trigger_welcome_email(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trigger_welcome_email() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  BEGIN
    PERFORM net.http_post(
      url := 'https://xwiqubcilptxzvdigsmp.supabase.co/functions/v1/send-welcome-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key'
        )
      ),
      body := jsonb_build_object('subscriber_id', NEW.id::text)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trigger_welcome_email failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: addresses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.addresses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    label text DEFAULT 'Home'::text NOT NULL,
    recipient_name text,
    line1 text NOT NULL,
    line2 text,
    city text NOT NULL,
    province text,
    postal_code text,
    country text DEFAULT 'South Africa'::text NOT NULL,
    phone text,
    is_default boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ai_conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    session_id text NOT NULL,
    messages jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ai_pulse_feeds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_pulse_feeds (
    source text NOT NULL,
    country text NOT NULL,
    url text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    last_status integer,
    last_ok_at timestamp with time zone,
    last_error text,
    consecutive_failures integer DEFAULT 0 NOT NULL,
    items_last_run integer DEFAULT 0 NOT NULL
);


--
-- Name: ai_pulse_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_pulse_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    url text NOT NULL,
    summary text,
    source text NOT NULL,
    category text NOT NULL,
    image_url text,
    published_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: newsletter_story_sends; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.newsletter_story_sends (
    item_id uuid NOT NULL,
    campaign_id uuid,
    sent_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ai_pulse_digest_candidates; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.ai_pulse_digest_candidates WITH (security_invoker='true') AS
 SELECT i.id,
    i.title,
    i.url,
    i.summary,
    i.source,
    i.category,
    i.published_at,
    f.country,
    public.ai_pulse_story_score(i.title, i.summary, i.source, i.category, i.published_at, f.country) AS score
   FROM (public.ai_pulse_items i
     LEFT JOIN public.ai_pulse_feeds f ON ((f.source = i.source)))
  WHERE ((i.title IS NOT NULL) AND (i.published_at > (now() - '72:00:00'::interval)) AND (NOT (EXISTS ( SELECT 1
           FROM public.newsletter_story_sends s
          WHERE (s.item_id = i.id)))));


--
-- Name: ai_pulse_feed_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_pulse_feed_requests (
    request_id bigint NOT NULL,
    source text NOT NULL,
    requested_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ai_usage_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_usage_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source text NOT NULL,
    provider text NOT NULL,
    model text NOT NULL,
    prompt_tokens integer,
    completion_tokens integer,
    total_tokens integer,
    estimated_cost_usd numeric(10,6),
    user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: automation_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_type text NOT NULL,
    source text DEFAULT 'make_pro'::text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb,
    status text DEFAULT 'pending'::text NOT NULL,
    response jsonb,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: brands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brands (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    logo_url text,
    description text DEFAULT ''::text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    parent_category_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: compliance_access_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.compliance_access_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_type text NOT NULL,
    quote_request_id uuid,
    email text,
    actor_id uuid,
    ip_address text,
    user_agent text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT compliance_access_log_event_type_check CHECK ((event_type = ANY (ARRAY['quote_submitted'::text, 'pack_unlock_success'::text, 'pack_unlock_denied'::text])))
);


--
-- Name: data_retention_policy; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.data_retention_policy (
    table_name text NOT NULL,
    timestamp_column text DEFAULT 'created_at'::text NOT NULL,
    retention_days integer NOT NULL,
    rationale text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT data_retention_policy_retention_days_check CHECK ((retention_days >= 7))
);


--
-- Name: email_send_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_send_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    message_id text,
    template_name text NOT NULL,
    recipient_email text NOT NULL,
    status text NOT NULL,
    error_message text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT email_send_log_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'suppressed'::text, 'failed'::text, 'bounced'::text, 'complained'::text, 'dlq'::text])))
);


--
-- Name: email_send_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_send_state (
    id integer DEFAULT 1 NOT NULL,
    retry_after_until timestamp with time zone,
    batch_size integer DEFAULT 10 NOT NULL,
    send_delay_ms integer DEFAULT 200 NOT NULL,
    auth_email_ttl_minutes integer DEFAULT 15 NOT NULL,
    transactional_email_ttl_minutes integer DEFAULT 60 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT email_send_state_id_check CHECK ((id = 1))
);


--
-- Name: email_unsubscribe_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_unsubscribe_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    token text NOT NULL,
    email text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    used_at timestamp with time zone
);


--
-- Name: engine_registry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.engine_registry (
    engine_key text NOT NULL,
    label text NOT NULL,
    kind text NOT NULL,
    log_source text,
    cron_job_name text,
    cadence text NOT NULL,
    max_silence_minutes integer NOT NULL,
    critical boolean DEFAULT false NOT NULL,
    notes text,
    CONSTRAINT engine_registry_kind_check CHECK ((kind = ANY (ARRAY['sync'::text, 'content'::text, 'commerce'::text, 'hygiene'::text, 'comms'::text])))
);


--
-- Name: engine_room_assessments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.engine_room_assessments (
    id bigint NOT NULL,
    severity text NOT NULL,
    headline text NOT NULL,
    findings jsonb DEFAULT '[]'::jsonb NOT NULL,
    narrative text,
    ai_model text,
    snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    alert_sent boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT engine_room_assessments_severity_check CHECK ((severity = ANY (ARRAY['ok'::text, 'notice'::text, 'warning'::text, 'critical'::text])))
);


--
-- Name: engine_room_assessments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.engine_room_assessments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: engine_room_assessments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.engine_room_assessments_id_seq OWNED BY public.engine_room_assessments.id;


--
-- Name: exchange_rates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exchange_rates (
    currency_code text NOT NULL,
    rate_to_zar numeric NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: home_showcase; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.home_showcase (
    slot text NOT NULL,
    rank integer NOT NULL,
    product_id uuid NOT NULL,
    score numeric(6,2) NOT NULL,
    components jsonb DEFAULT '{}'::jsonb NOT NULL,
    reasons jsonb DEFAULT '[]'::jsonb NOT NULL,
    refreshed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT home_showcase_rank_positive CHECK (((rank >= 1) AND (rank <= 48))),
    CONSTRAINT home_showcase_slot_known CHECK ((slot = ANY (ARRAY['ai_picks'::text, 'featured'::text])))
);


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text,
    price numeric(14,2) DEFAULT 0 NOT NULL,
    category text DEFAULT ''::text,
    images text[] DEFAULT '{}'::text[],
    in_stock boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    slug text,
    specifications jsonb DEFAULT '{}'::jsonb,
    brand text DEFAULT ''::text,
    stock_quantity integer DEFAULT 0,
    stock_status public.stock_status DEFAULT 'in_stock'::public.stock_status,
    last_synced_at timestamp with time zone,
    is_active boolean DEFAULT true,
    category_id uuid,
    brand_id uuid,
    sku text,
    is_ai_product boolean DEFAULT false,
    search_vector tsvector GENERATED ALWAYS AS ((((setweight(to_tsvector('english'::regconfig, COALESCE(name, ''::text)), 'A'::"char") || setweight(to_tsvector('english'::regconfig, COALESCE(brand, ''::text)), 'B'::"char")) || setweight(to_tsvector('english'::regconfig, COALESCE(category, ''::text)), 'B'::"char")) || setweight(to_tsvector('english'::regconfig, COALESCE(description, ''::text)), 'C'::"char"))) STORED,
    audience text DEFAULT 'business'::text NOT NULL,
    CONSTRAINT products_audience_check CHECK ((audience = ANY (ARRAY['residential'::text, 'business'::text])))
);


--
-- Name: home_showcase_candidates; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.home_showcase_candidates WITH (security_invoker='true') AS
 SELECT p.id,
    p.name,
    p.brand,
    p.category,
    p.price,
    p.in_stock,
    p.is_ai_product,
    ((j.payload ->> 'score'::text))::numeric AS score,
    (j.payload -> 'components'::text) AS components,
    (j.payload -> 'reasons'::text) AS reasons
   FROM (public.products p
     CROSS JOIN LATERAL ( SELECT public.score_home_product(p.category, p.name, p.brand, p.price, p.in_stock, p.stock_quantity, p.images, p.is_ai_product, (0)::numeric) AS payload) j)
  WHERE (p.is_active AND (p.audience = 'residential'::text) AND public.merch_is_home_eligible(p.category, p.name, p.price, p.images, p.is_ai_product));


--
-- Name: image_blocklist; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.image_blocklist (
    url text NOT NULL,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: newsletter_campaigns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.newsletter_campaigns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subject text NOT NULL,
    preview_text text,
    body_html text NOT NULL,
    category_filter text,
    status text DEFAULT 'draft'::text NOT NULL,
    recipient_count integer,
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: newsletter_subscribers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.newsletter_subscribers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    name text,
    user_id uuid,
    source text DEFAULT 'footer'::text NOT NULL,
    interested_categories text[] DEFAULT '{}'::text[],
    unsubscribe_token uuid DEFAULT gen_random_uuid() NOT NULL,
    subscribed_at timestamp with time zone DEFAULT now() NOT NULL,
    unsubscribed_at timestamp with time zone
);


--
-- Name: notification_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_preferences (
    user_id uuid NOT NULL,
    order_updates boolean DEFAULT true NOT NULL,
    delivery_alerts boolean DEFAULT true NOT NULL,
    promotional_emails boolean DEFAULT false NOT NULL,
    sms_notifications boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    type text DEFAULT 'info'::text NOT NULL,
    title text NOT NULL,
    message text DEFAULT ''::text NOT NULL,
    is_read boolean DEFAULT false NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid
);


--
-- Name: order_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    actor_id uuid,
    actor_email text,
    event_type text NOT NULL,
    from_value text,
    to_value text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    product_id uuid NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    unit_price numeric(10,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_name text NOT NULL,
    customer_email text NOT NULL,
    customer_phone text NOT NULL,
    address text NOT NULL,
    city text NOT NULL,
    postal_code text NOT NULL,
    total_amount numeric(10,2) NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    payment_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid,
    payment_status public.payment_status DEFAULT 'unpaid'::public.payment_status,
    order_status public.order_status DEFAULT 'pending'::public.order_status,
    tracking_number text,
    province text
);


--
-- Name: payment_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider text DEFAULT 'payfast'::text NOT NULL,
    provider_payment_id text,
    order_id uuid,
    event_type text NOT NULL,
    payment_status text,
    amount_gross numeric,
    amount_fee numeric,
    amount_net numeric,
    outcome text NOT NULL,
    sandbox boolean DEFAULT false NOT NULL,
    source_ip text,
    signature_valid boolean,
    notified boolean DEFAULT false NOT NULL,
    raw_payload jsonb,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: product_costs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_costs (
    product_id uuid NOT NULL,
    cost_price numeric DEFAULT 0,
    selling_price numeric DEFAULT 0,
    margin_percentage numeric DEFAULT 0,
    axiz_product_id text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: product_facets_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_facets_cache (
    facet_type text NOT NULL,
    facet_value text NOT NULL,
    product_count bigint NOT NULL,
    refreshed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: profile_admin_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profile_admin_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text,
    email text,
    phone text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_phone_verified boolean DEFAULT false NOT NULL,
    address_line1 text,
    address_line2 text,
    avatar_url text,
    city text,
    company_name text,
    country text DEFAULT 'South Africa'::text NOT NULL,
    customer_type text DEFAULT 'residential'::text NOT NULL,
    id_number text,
    last_login_at timestamp with time zone,
    marketing_opt_in boolean DEFAULT false NOT NULL,
    postal_code text,
    preferred_language text DEFAULT 'en'::text NOT NULL,
    province text,
    vat_number text,
    CONSTRAINT profiles_customer_type_check CHECK ((customer_type = ANY (ARRAY['residential'::text, 'business'::text])))
);


--
-- Name: quote_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quote_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organisation_name text NOT NULL,
    contact_name text NOT NULL,
    email text NOT NULL,
    phone text,
    entity_type text DEFAULT 'private'::text NOT NULL,
    requirements text NOT NULL,
    estimated_value numeric,
    status text DEFAULT 'new'::text NOT NULL,
    admin_notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: rate_limit_buckets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rate_limit_buckets (
    bucket_key text NOT NULL,
    tokens numeric NOT NULL,
    last_refill timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: returns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.returns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    user_id uuid NOT NULL,
    reason text DEFAULT ''::text NOT NULL,
    status public.return_status DEFAULT 'requested'::public.return_status NOT NULL,
    refund_amount numeric DEFAULT 0,
    admin_notes text DEFAULT ''::text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: security_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.security_events (
    id bigint NOT NULL,
    kind text NOT NULL,
    severity text DEFAULT 'info'::text NOT NULL,
    actor text,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT security_events_severity_check CHECK ((severity = ANY (ARRAY['info'::text, 'low'::text, 'medium'::text, 'high'::text, 'critical'::text])))
);


--
-- Name: security_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.security_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: security_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.security_events_id_seq OWNED BY public.security_events.id;


--
-- Name: sms_send_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sms_send_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    phone text NOT NULL,
    purpose text DEFAULT 'phone_verification'::text NOT NULL,
    status text NOT NULL,
    telnyx_status_code integer,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sms_send_log_status_check CHECK ((status = ANY (ARRAY['sent'::text, 'failed'::text])))
);


--
-- Name: spend_caps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.spend_caps (
    provider text NOT NULL,
    label text NOT NULL,
    daily_cap_zar numeric(10,2) NOT NULL,
    monthly_cap_zar numeric(10,2) NOT NULL,
    daily_call_cap integer NOT NULL,
    hard_stop boolean DEFAULT true NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT spend_caps_calls_sane CHECK (((daily_call_cap >= 0) AND (daily_call_cap <= 200000))),
    CONSTRAINT spend_caps_daily_sane CHECK (((daily_cap_zar >= (0)::numeric) AND (daily_cap_zar <= (2000)::numeric))),
    CONSTRAINT spend_caps_monthly_ge_daily CHECK ((monthly_cap_zar >= daily_cap_zar)),
    CONSTRAINT spend_caps_monthly_sane CHECK (((monthly_cap_zar >= (0)::numeric) AND (monthly_cap_zar <= (20000)::numeric)))
);


--
-- Name: spend_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.spend_ledger (
    id bigint NOT NULL,
    provider text NOT NULL,
    source text NOT NULL,
    units numeric DEFAULT 1 NOT NULL,
    cost_zar numeric(12,4) DEFAULT 0 NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: spend_ledger_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.spend_ledger_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: spend_ledger_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.spend_ledger_id_seq OWNED BY public.spend_ledger.id;


--
-- Name: store_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.store_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    value text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: support_tickets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_tickets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    order_id uuid,
    type public.ticket_type DEFAULT 'inquiry'::public.ticket_type NOT NULL,
    status public.ticket_status DEFAULT 'open'::public.ticket_status NOT NULL,
    subject text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: suppressed_emails; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.suppressed_emails (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    reason text NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT suppressed_emails_reason_check CHECK ((reason = ANY (ARRAY['unsubscribe'::text, 'bounce'::text, 'complaint'::text])))
);


--
-- Name: sync_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sync_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source text DEFAULT 'axiz'::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    items_synced integer DEFAULT 0,
    items_failed integer DEFAULT 0,
    error_details text,
    started_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: threat_blocks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.threat_blocks (
    block_key text NOT NULL,
    reason text NOT NULL,
    category text NOT NULL,
    score integer NOT NULL,
    offences integer DEFAULT 1 NOT NULL,
    blocked_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: threat_quarantine; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.threat_quarantine (
    id bigint NOT NULL,
    surface text NOT NULL,
    email text,
    score integer NOT NULL,
    category text NOT NULL,
    payload jsonb NOT NULL,
    hits jsonb DEFAULT '[]'::jsonb NOT NULL,
    released boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: threat_quarantine_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.threat_quarantine_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: threat_quarantine_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.threat_quarantine_id_seq OWNED BY public.threat_quarantine.id;


--
-- Name: threat_signatures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.threat_signatures (
    id bigint NOT NULL,
    category text NOT NULL,
    label text NOT NULL,
    pattern text NOT NULL,
    weight integer NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT threat_signatures_category_check CHECK ((category = ANY (ARRAY['phishing'::text, 'spam'::text, 'injection'::text, 'bot'::text]))),
    CONSTRAINT threat_signatures_weight_check CHECK (((weight >= 1) AND (weight <= 100)))
);


--
-- Name: threat_signatures_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.threat_signatures_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: threat_signatures_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.threat_signatures_id_seq OWNED BY public.threat_signatures.id;


--
-- Name: ticket_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ticket_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ticket_id uuid NOT NULL,
    sender_id uuid NOT NULL,
    message text NOT NULL,
    is_admin boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role public.app_role NOT NULL
);


--
-- Name: wishlists; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wishlists (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    product_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: engine_room_assessments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engine_room_assessments ALTER COLUMN id SET DEFAULT nextval('public.engine_room_assessments_id_seq'::regclass);


--
-- Name: security_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_events ALTER COLUMN id SET DEFAULT nextval('public.security_events_id_seq'::regclass);


--
-- Name: spend_ledger id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spend_ledger ALTER COLUMN id SET DEFAULT nextval('public.spend_ledger_id_seq'::regclass);


--
-- Name: threat_quarantine id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.threat_quarantine ALTER COLUMN id SET DEFAULT nextval('public.threat_quarantine_id_seq'::regclass);


--
-- Name: threat_signatures id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.threat_signatures ALTER COLUMN id SET DEFAULT nextval('public.threat_signatures_id_seq'::regclass);


--
-- Name: addresses addresses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.addresses
    ADD CONSTRAINT addresses_pkey PRIMARY KEY (id);


--
-- Name: ai_conversations ai_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_conversations
    ADD CONSTRAINT ai_conversations_pkey PRIMARY KEY (id);


--
-- Name: ai_pulse_feed_requests ai_pulse_feed_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_pulse_feed_requests
    ADD CONSTRAINT ai_pulse_feed_requests_pkey PRIMARY KEY (request_id);


--
-- Name: ai_pulse_feeds ai_pulse_feeds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_pulse_feeds
    ADD CONSTRAINT ai_pulse_feeds_pkey PRIMARY KEY (source);


--
-- Name: ai_pulse_items ai_pulse_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_pulse_items
    ADD CONSTRAINT ai_pulse_items_pkey PRIMARY KEY (id);


--
-- Name: ai_pulse_items ai_pulse_items_url_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_pulse_items
    ADD CONSTRAINT ai_pulse_items_url_key UNIQUE (url);


--
-- Name: ai_usage_log ai_usage_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usage_log
    ADD CONSTRAINT ai_usage_log_pkey PRIMARY KEY (id);


--
-- Name: automation_events automation_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_events
    ADD CONSTRAINT automation_events_pkey PRIMARY KEY (id);


--
-- Name: brands brands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brands
    ADD CONSTRAINT brands_pkey PRIMARY KEY (id);


--
-- Name: brands brands_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brands
    ADD CONSTRAINT brands_slug_key UNIQUE (slug);


--
-- Name: categories categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);


--
-- Name: categories categories_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_slug_key UNIQUE (slug);


--
-- Name: compliance_access_log compliance_access_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_access_log
    ADD CONSTRAINT compliance_access_log_pkey PRIMARY KEY (id);


--
-- Name: compliance_documents compliance_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_documents
    ADD CONSTRAINT compliance_documents_pkey PRIMARY KEY (id);


--
-- Name: data_retention_policy data_retention_policy_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_retention_policy
    ADD CONSTRAINT data_retention_policy_pkey PRIMARY KEY (table_name);


--
-- Name: email_send_log email_send_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_send_log
    ADD CONSTRAINT email_send_log_pkey PRIMARY KEY (id);


--
-- Name: email_send_state email_send_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_send_state
    ADD CONSTRAINT email_send_state_pkey PRIMARY KEY (id);


--
-- Name: email_unsubscribe_tokens email_unsubscribe_tokens_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_unsubscribe_tokens
    ADD CONSTRAINT email_unsubscribe_tokens_email_key UNIQUE (email);


--
-- Name: email_unsubscribe_tokens email_unsubscribe_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_unsubscribe_tokens
    ADD CONSTRAINT email_unsubscribe_tokens_pkey PRIMARY KEY (id);


--
-- Name: email_unsubscribe_tokens email_unsubscribe_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_unsubscribe_tokens
    ADD CONSTRAINT email_unsubscribe_tokens_token_key UNIQUE (token);


--
-- Name: engine_registry engine_registry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engine_registry
    ADD CONSTRAINT engine_registry_pkey PRIMARY KEY (engine_key);


--
-- Name: engine_room_assessments engine_room_assessments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engine_room_assessments
    ADD CONSTRAINT engine_room_assessments_pkey PRIMARY KEY (id);


--
-- Name: exchange_rates exchange_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exchange_rates
    ADD CONSTRAINT exchange_rates_pkey PRIMARY KEY (currency_code);


--
-- Name: home_showcase home_showcase_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.home_showcase
    ADD CONSTRAINT home_showcase_pkey PRIMARY KEY (slot, rank);


--
-- Name: image_blocklist image_blocklist_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.image_blocklist
    ADD CONSTRAINT image_blocklist_pkey PRIMARY KEY (url);


--
-- Name: newsletter_campaigns newsletter_campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.newsletter_campaigns
    ADD CONSTRAINT newsletter_campaigns_pkey PRIMARY KEY (id);


--
-- Name: newsletter_story_sends newsletter_story_sends_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.newsletter_story_sends
    ADD CONSTRAINT newsletter_story_sends_pkey PRIMARY KEY (item_id);


--
-- Name: newsletter_subscribers newsletter_subscribers_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.newsletter_subscribers
    ADD CONSTRAINT newsletter_subscribers_email_key UNIQUE (email);


--
-- Name: newsletter_subscribers newsletter_subscribers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.newsletter_subscribers
    ADD CONSTRAINT newsletter_subscribers_pkey PRIMARY KEY (id);


--
-- Name: notification_preferences notification_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_pkey PRIMARY KEY (user_id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: order_audit_log order_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_audit_log
    ADD CONSTRAINT order_audit_log_pkey PRIMARY KEY (id);


--
-- Name: order_items order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: payment_events payment_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_events
    ADD CONSTRAINT payment_events_pkey PRIMARY KEY (id);


--
-- Name: product_costs product_costs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_costs
    ADD CONSTRAINT product_costs_pkey PRIMARY KEY (product_id);


--
-- Name: product_facets_cache product_facets_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_facets_cache
    ADD CONSTRAINT product_facets_cache_pkey PRIMARY KEY (facet_type, facet_value);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: products products_sku_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_sku_key UNIQUE (sku);


--
-- Name: profile_admin_notes profile_admin_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_admin_notes
    ADD CONSTRAINT profile_admin_notes_pkey PRIMARY KEY (id);


--
-- Name: profile_admin_notes profile_admin_notes_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_admin_notes
    ADD CONSTRAINT profile_admin_notes_user_id_key UNIQUE (user_id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_user_id_key UNIQUE (user_id);


--
-- Name: quote_requests quote_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quote_requests
    ADD CONSTRAINT quote_requests_pkey PRIMARY KEY (id);


--
-- Name: rate_limit_buckets rate_limit_buckets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_limit_buckets
    ADD CONSTRAINT rate_limit_buckets_pkey PRIMARY KEY (bucket_key);


--
-- Name: returns returns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.returns
    ADD CONSTRAINT returns_pkey PRIMARY KEY (id);


--
-- Name: security_events security_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_events
    ADD CONSTRAINT security_events_pkey PRIMARY KEY (id);


--
-- Name: sms_send_log sms_send_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_send_log
    ADD CONSTRAINT sms_send_log_pkey PRIMARY KEY (id);


--
-- Name: spend_caps spend_caps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spend_caps
    ADD CONSTRAINT spend_caps_pkey PRIMARY KEY (provider);


--
-- Name: spend_ledger spend_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spend_ledger
    ADD CONSTRAINT spend_ledger_pkey PRIMARY KEY (id);


--
-- Name: store_settings store_settings_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_settings
    ADD CONSTRAINT store_settings_key_key UNIQUE (key);


--
-- Name: store_settings store_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_settings
    ADD CONSTRAINT store_settings_pkey PRIMARY KEY (id);


--
-- Name: support_tickets support_tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_pkey PRIMARY KEY (id);


--
-- Name: suppressed_emails suppressed_emails_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppressed_emails
    ADD CONSTRAINT suppressed_emails_email_key UNIQUE (email);


--
-- Name: suppressed_emails suppressed_emails_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppressed_emails
    ADD CONSTRAINT suppressed_emails_pkey PRIMARY KEY (id);


--
-- Name: sync_logs sync_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_logs
    ADD CONSTRAINT sync_logs_pkey PRIMARY KEY (id);


--
-- Name: threat_blocks threat_blocks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.threat_blocks
    ADD CONSTRAINT threat_blocks_pkey PRIMARY KEY (block_key);


--
-- Name: threat_quarantine threat_quarantine_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.threat_quarantine
    ADD CONSTRAINT threat_quarantine_pkey PRIMARY KEY (id);


--
-- Name: threat_signatures threat_signatures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.threat_signatures
    ADD CONSTRAINT threat_signatures_pkey PRIMARY KEY (id);


--
-- Name: ticket_messages ticket_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_messages
    ADD CONSTRAINT ticket_messages_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_user_id_role_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);


--
-- Name: wishlists wishlists_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wishlists
    ADD CONSTRAINT wishlists_pkey PRIMARY KEY (id);


--
-- Name: wishlists wishlists_user_id_product_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wishlists
    ADD CONSTRAINT wishlists_user_id_product_id_key UNIQUE (user_id, product_id);


--
-- Name: ai_usage_log_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_usage_log_created_at_idx ON public.ai_usage_log USING btree (created_at DESC);


--
-- Name: ai_usage_log_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_usage_log_source_idx ON public.ai_usage_log USING btree (source);


--
-- Name: engine_room_assessments_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX engine_room_assessments_time_idx ON public.engine_room_assessments USING btree (created_at DESC);


--
-- Name: home_showcase_product_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX home_showcase_product_unique ON public.home_showcase USING btree (product_id);


--
-- Name: idx_ai_conversations_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_conversations_session ON public.ai_conversations USING btree (session_id);


--
-- Name: idx_ai_pulse_published; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_pulse_published ON public.ai_pulse_items USING btree (published_at DESC);


--
-- Name: idx_categories_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_categories_parent ON public.categories USING btree (parent_category_id);


--
-- Name: idx_categories_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_categories_slug ON public.categories USING btree (slug);


--
-- Name: idx_compliance_access_log_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compliance_access_log_created ON public.compliance_access_log USING btree (created_at DESC);


--
-- Name: idx_compliance_access_log_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compliance_access_log_email ON public.compliance_access_log USING btree (lower(email));


--
-- Name: idx_compliance_access_log_quote; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compliance_access_log_quote ON public.compliance_access_log USING btree (quote_request_id);


--
-- Name: idx_email_send_log_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_send_log_created ON public.email_send_log USING btree (created_at DESC);


--
-- Name: idx_email_send_log_message; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_send_log_message ON public.email_send_log USING btree (message_id);


--
-- Name: idx_email_send_log_message_sent_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_email_send_log_message_sent_unique ON public.email_send_log USING btree (message_id) WHERE (status = 'sent'::text);


--
-- Name: idx_email_send_log_recipient; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_send_log_recipient ON public.email_send_log USING btree (recipient_email);


--
-- Name: idx_notifications_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user_id ON public.notifications USING btree (user_id);


--
-- Name: idx_order_audit_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_audit_order_id ON public.order_audit_log USING btree (order_id, created_at DESC);


--
-- Name: idx_order_items_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_order_id ON public.order_items USING btree (order_id);


--
-- Name: idx_orders_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_created ON public.orders USING btree (created_at DESC);


--
-- Name: idx_orders_order_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_order_status ON public.orders USING btree (order_status);


--
-- Name: idx_orders_payment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_payment ON public.orders USING btree (payment_status);


--
-- Name: idx_orders_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_status ON public.orders USING btree (order_status);


--
-- Name: idx_orders_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_user ON public.orders USING btree (user_id);


--
-- Name: idx_orders_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_user_id ON public.orders USING btree (user_id);


--
-- Name: idx_payment_events_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_events_created ON public.payment_events USING btree (created_at DESC);


--
-- Name: idx_payment_events_idempotency; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_payment_events_idempotency ON public.payment_events USING btree (provider, provider_payment_id, payment_status) WHERE ((outcome = 'processed'::text) AND (provider_payment_id IS NOT NULL));


--
-- Name: idx_payment_events_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_events_order ON public.payment_events USING btree (order_id, created_at DESC);


--
-- Name: idx_payment_events_outcome; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_events_outcome ON public.payment_events USING btree (outcome, created_at DESC);


--
-- Name: idx_products_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_active ON public.products USING btree (is_active);


--
-- Name: idx_products_active_audience; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_active_audience ON public.products USING btree (audience) WHERE (is_active = true);


--
-- Name: idx_products_active_audience_ai_price; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_active_audience_ai_price ON public.products USING btree (audience, is_ai_product, price) WHERE (is_active = true);


--
-- Name: idx_products_active_newest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_active_newest ON public.products USING btree (last_synced_at DESC NULLS LAST, name) WHERE (is_active = true);


--
-- Name: idx_products_active_price_asc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_active_price_asc ON public.products USING btree (price) WHERE (is_active = true);


--
-- Name: idx_products_active_price_desc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_active_price_desc ON public.products USING btree (price DESC NULLS LAST) WHERE (is_active = true);


--
-- Name: idx_products_brand_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_brand_id ON public.products USING btree (brand_id);


--
-- Name: idx_products_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_category ON public.products USING btree (category_id);


--
-- Name: idx_products_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_slug ON public.products USING btree (slug);


--
-- Name: idx_products_stock_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_stock_status ON public.products USING btree (stock_status);


--
-- Name: idx_profiles_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_user_id ON public.profiles USING btree (user_id);


--
-- Name: idx_returns_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_returns_order_id ON public.returns USING btree (order_id);


--
-- Name: idx_returns_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_returns_user_id ON public.returns USING btree (user_id);


--
-- Name: idx_sms_send_log_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sms_send_log_user_created ON public.sms_send_log USING btree (user_id, created_at DESC);


--
-- Name: idx_suppressed_emails_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_suppressed_emails_email ON public.suppressed_emails USING btree (email);


--
-- Name: idx_ticket_messages_ticket; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ticket_messages_ticket ON public.ticket_messages USING btree (ticket_id);


--
-- Name: idx_tickets_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tickets_order ON public.support_tickets USING btree (order_id);


--
-- Name: idx_tickets_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tickets_status ON public.support_tickets USING btree (status);


--
-- Name: idx_tickets_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tickets_user ON public.support_tickets USING btree (user_id);


--
-- Name: idx_unsubscribe_tokens_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_unsubscribe_tokens_token ON public.email_unsubscribe_tokens USING btree (token);


--
-- Name: newsletter_subscribers_email_lower_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX newsletter_subscribers_email_lower_key ON public.newsletter_subscribers USING btree (lower(email));


--
-- Name: products_audience_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX products_audience_idx ON public.products USING btree (audience);


--
-- Name: products_first_image_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX products_first_image_idx ON public.products USING btree ((images[1])) WHERE (is_active = true);


--
-- Name: products_is_ai_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX products_is_ai_product_idx ON public.products USING btree (is_ai_product) WHERE (is_ai_product = true);


--
-- Name: products_search_vector_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX products_search_vector_idx ON public.products USING gin (search_vector);


--
-- Name: profiles_id_number_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX profiles_id_number_unique_idx ON public.profiles USING btree (id_number) WHERE (id_number IS NOT NULL);


--
-- Name: profiles_phone_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX profiles_phone_unique_idx ON public.profiles USING btree (phone) WHERE (phone IS NOT NULL);


--
-- Name: profiles_vat_number_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX profiles_vat_number_unique_idx ON public.profiles USING btree (vat_number) WHERE ((vat_number IS NOT NULL) AND (customer_type = 'business'::text));


--
-- Name: security_events_severity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX security_events_severity_idx ON public.security_events USING btree (severity, created_at DESC);


--
-- Name: security_events_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX security_events_time_idx ON public.security_events USING btree (created_at DESC);


--
-- Name: spend_ledger_provider_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX spend_ledger_provider_time_idx ON public.spend_ledger USING btree (provider, occurred_at DESC);


--
-- Name: threat_blocks_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX threat_blocks_expiry_idx ON public.threat_blocks USING btree (expires_at);


--
-- Name: threat_quarantine_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX threat_quarantine_time_idx ON public.threat_quarantine USING btree (created_at DESC);


--
-- Name: wishlists_product_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wishlists_product_id_idx ON public.wishlists USING btree (product_id);


--
-- Name: wishlists_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wishlists_user_id_idx ON public.wishlists USING btree (user_id);


--
-- Name: newsletter_subscribers newsletter_welcome_email; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER newsletter_welcome_email AFTER INSERT ON public.newsletter_subscribers FOR EACH ROW EXECUTE FUNCTION public.trigger_welcome_email();


--
-- Name: products products_classify_category; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER products_classify_category BEFORE INSERT OR UPDATE OF name, category ON public.products FOR EACH ROW EXECUTE FUNCTION public.products_set_category();


--
-- Name: products products_enforce_blocklist; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER products_enforce_blocklist BEFORE INSERT OR UPDATE OF images ON public.products FOR EACH ROW EXECUTE FUNCTION public.enforce_image_blocklist();


--
-- Name: spend_caps spend_caps_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER spend_caps_audit BEFORE UPDATE ON public.spend_caps FOR EACH ROW EXECUTE FUNCTION public.audit_spend_cap_change();


--
-- Name: newsletter_subscribers threat_gate_newsletter; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER threat_gate_newsletter BEFORE INSERT ON public.newsletter_subscribers FOR EACH ROW EXECUTE FUNCTION public.tg_threat_newsletter();


--
-- Name: quote_requests threat_gate_quote; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER threat_gate_quote BEFORE INSERT ON public.quote_requests FOR EACH ROW EXECUTE FUNCTION public.tg_threat_quote();


--
-- Name: compliance_documents trg_compliance_documents_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_compliance_documents_updated_at BEFORE UPDATE ON public.compliance_documents FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: orders trg_log_order_changes; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_log_order_changes AFTER INSERT OR UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.log_order_changes();


--
-- Name: quote_requests trg_log_quote_request_submitted; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_log_quote_request_submitted AFTER INSERT ON public.quote_requests FOR EACH ROW EXECUTE FUNCTION public.log_quote_request_submitted();


--
-- Name: ai_conversations update_ai_conversations_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_ai_conversations_updated_at BEFORE UPDATE ON public.ai_conversations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: brands update_brands_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_brands_updated_at BEFORE UPDATE ON public.brands FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: categories update_categories_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_categories_updated_at BEFORE UPDATE ON public.categories FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: orders update_orders_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: products update_products_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: profile_admin_notes update_profile_admin_notes_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_profile_admin_notes_updated_at BEFORE UPDATE ON public.profile_admin_notes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: profiles update_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: returns update_returns_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_returns_updated_at BEFORE UPDATE ON public.returns FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: store_settings update_store_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_store_settings_updated_at BEFORE UPDATE ON public.store_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: support_tickets update_tickets_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_tickets_updated_at BEFORE UPDATE ON public.support_tickets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: addresses addresses_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.addresses
    ADD CONSTRAINT addresses_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: ai_pulse_feed_requests ai_pulse_feed_requests_source_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_pulse_feed_requests
    ADD CONSTRAINT ai_pulse_feed_requests_source_fkey FOREIGN KEY (source) REFERENCES public.ai_pulse_feeds(source) ON DELETE CASCADE;


--
-- Name: ai_usage_log ai_usage_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usage_log
    ADD CONSTRAINT ai_usage_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: categories categories_parent_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_parent_category_id_fkey FOREIGN KEY (parent_category_id) REFERENCES public.categories(id) ON DELETE SET NULL;


--
-- Name: home_showcase home_showcase_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.home_showcase
    ADD CONSTRAINT home_showcase_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: newsletter_story_sends newsletter_story_sends_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.newsletter_story_sends
    ADD CONSTRAINT newsletter_story_sends_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.newsletter_campaigns(id) ON DELETE SET NULL;


--
-- Name: newsletter_story_sends newsletter_story_sends_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.newsletter_story_sends
    ADD CONSTRAINT newsletter_story_sends_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.ai_pulse_items(id) ON DELETE CASCADE;


--
-- Name: newsletter_subscribers newsletter_subscribers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.newsletter_subscribers
    ADD CONSTRAINT newsletter_subscribers_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: notification_preferences notification_preferences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: order_audit_log order_audit_log_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_audit_log
    ADD CONSTRAINT order_audit_log_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_items order_items_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_items order_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: orders orders_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: payment_events payment_events_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_events
    ADD CONSTRAINT payment_events_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- Name: product_costs product_costs_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_costs
    ADD CONSTRAINT product_costs_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: products products_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE SET NULL;


--
-- Name: profile_admin_notes profile_admin_notes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_admin_notes
    ADD CONSTRAINT profile_admin_notes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: sms_send_log sms_send_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_send_log
    ADD CONSTRAINT sms_send_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: support_tickets support_tickets_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- Name: support_tickets support_tickets_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: ticket_messages ticket_messages_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_messages
    ADD CONSTRAINT ticket_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: ticket_messages ticket_messages_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_messages
    ADD CONSTRAINT ticket_messages_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.support_tickets(id) ON DELETE CASCADE;


--
-- Name: user_roles user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: wishlists wishlists_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wishlists
    ADD CONSTRAINT wishlists_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: wishlists wishlists_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wishlists
    ADD CONSTRAINT wishlists_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: threat_blocks Admins can clear threat blocks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can clear threat blocks" ON public.threat_blocks FOR DELETE USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: order_items Admins can delete order items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can delete order items" ON public.order_items FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: order_audit_log Admins can insert audit entries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can insert audit entries" ON public.order_audit_log FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: automation_events Admins can manage automation events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage automation events" ON public.automation_events TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: brands Admins can manage brands; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage brands" ON public.brands TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: newsletter_campaigns Admins can manage campaigns; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage campaigns" ON public.newsletter_campaigns TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: categories Admins can manage categories; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage categories" ON public.categories TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: notifications Admins can manage notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage notifications" ON public.notifications TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: product_costs Admins can manage product costs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage product costs" ON public.product_costs TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: products Admins can manage products; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage products" ON public.products TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: profile_admin_notes Admins can manage profile admin notes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage profile admin notes" ON public.profile_admin_notes TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: quote_requests Admins can manage quote requests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage quote requests" ON public.quote_requests TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: store_settings Admins can manage settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage settings" ON public.store_settings TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: newsletter_subscribers Admins can manage subscribers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage subscribers" ON public.newsletter_subscribers TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: sync_logs Admins can manage sync logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage sync logs" ON public.sync_logs TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: home_showcase Admins can manage the home showcase; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage the home showcase" ON public.home_showcase TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: email_send_log Admins can read email send log; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can read email send log" ON public.email_send_log FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: data_retention_policy Admins can read retention policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can read retention policy" ON public.data_retention_policy FOR SELECT USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: profiles Admins can update all profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update all profiles" ON public.profiles FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: returns Admins can update all returns; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update all returns" ON public.returns FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: support_tickets Admins can update all tickets; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update all tickets" ON public.support_tickets FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: order_items Admins can update order items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update order items" ON public.order_items FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: orders Admins can update orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update orders" ON public.orders FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: spend_caps Admins can update spend caps; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update spend caps" ON public.spend_caps FOR UPDATE USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: ai_usage_log Admins can view AI usage log; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view AI usage log" ON public.ai_usage_log FOR SELECT USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: order_audit_log Admins can view all audit entries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view all audit entries" ON public.order_audit_log FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: ai_conversations Admins can view all conversations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view all conversations" ON public.ai_conversations FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: ticket_messages Admins can view all messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view all messages" ON public.ticket_messages FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: profiles Admins can view all profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view all profiles" ON public.profiles FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: returns Admins can view all returns; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view all returns" ON public.returns FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: support_tickets Admins can view all tickets; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view all tickets" ON public.support_tickets FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: engine_room_assessments Admins can view assessments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view assessments" ON public.engine_room_assessments FOR SELECT USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: automation_events Admins can view automation events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view automation events" ON public.automation_events FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: engine_registry Admins can view engine registry; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view engine registry" ON public.engine_registry FOR SELECT USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: notifications Admins can view notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view notifications" ON public.notifications FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: payment_events Admins can view payment events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view payment events" ON public.payment_events FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: threat_quarantine Admins can view quarantine; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view quarantine" ON public.threat_quarantine FOR SELECT USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: security_events Admins can view security events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view security events" ON public.security_events FOR SELECT USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: sms_send_log Admins can view sms send log; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view sms send log" ON public.sms_send_log FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: spend_caps Admins can view spend caps; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view spend caps" ON public.spend_caps FOR SELECT USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: spend_ledger Admins can view spend ledger; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view spend ledger" ON public.spend_ledger FOR SELECT USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: sync_logs Admins can view sync logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view sync logs" ON public.sync_logs FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: threat_blocks Admins can view threat blocks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view threat blocks" ON public.threat_blocks FOR SELECT USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: threat_signatures Admins can view threat signatures; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view threat signatures" ON public.threat_signatures FOR SELECT USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: compliance_documents Admins manage compliance documents; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins manage compliance documents" ON public.compliance_documents TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: image_blocklist Admins manage image blocklist; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins manage image blocklist" ON public.image_blocklist TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: ai_pulse_feeds Admins manage pulse feeds; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins manage pulse feeds" ON public.ai_pulse_feeds TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: compliance_access_log Admins read compliance access log; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins read compliance access log" ON public.compliance_access_log FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: addresses Admins view all addresses; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins view all addresses" ON public.addresses FOR SELECT USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: wishlists Admins view all wishlists; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins view all wishlists" ON public.wishlists FOR SELECT USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: ai_conversations Anyone can create conversations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can create conversations" ON public.ai_conversations FOR INSERT WITH CHECK (((user_id IS NULL) OR (user_id = auth.uid())));


--
-- Name: order_items Anyone can create order items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can create order items" ON public.order_items FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.orders o
  WHERE ((o.id = order_items.order_id) AND ((o.user_id IS NULL) OR (o.user_id = auth.uid()))))));


--
-- Name: quote_requests Anyone can submit a validated quote request; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can submit a validated quote request" ON public.quote_requests FOR INSERT TO anon, authenticated WITH CHECK ((((length(COALESCE(organisation_name, ''::text)) >= 2) AND (length(COALESCE(organisation_name, ''::text)) <= 200)) AND ((length(COALESCE(contact_name, ''::text)) >= 2) AND (length(COALESCE(contact_name, ''::text)) <= 120)) AND (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'::text) AND ((length(email) >= 5) AND (length(email) <= 320)) AND ((length(requirements) >= 10) AND (length(requirements) <= 5000)) AND (entity_type = ANY (ARRAY['private'::text, 'public'::text, 'ngo'::text, 'education'::text, 'government'::text, 'sme'::text, 'enterprise'::text])) AND ((estimated_value IS NULL) OR ((estimated_value >= (0)::numeric) AND (estimated_value < (1000000000)::numeric))) AND ((phone IS NULL) OR ((length(phone) >= 5) AND (length(phone) <= 40)))));


--
-- Name: newsletter_subscribers Anyone can subscribe; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can subscribe" ON public.newsletter_subscribers FOR INSERT WITH CHECK (((email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'::text) AND ((length(email) >= 5) AND (length(email) <= 254)) AND ((user_id IS NULL) OR (user_id = auth.uid()))));


--
-- Name: ai_pulse_items Anyone can view AI pulse items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view AI pulse items" ON public.ai_pulse_items FOR SELECT USING (true);


--
-- Name: brands Anyone can view brands; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view brands" ON public.brands FOR SELECT USING (true);


--
-- Name: categories Anyone can view categories; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view categories" ON public.categories FOR SELECT USING (true);


--
-- Name: exchange_rates Anyone can view exchange rates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view exchange rates" ON public.exchange_rates FOR SELECT USING (true);


--
-- Name: products Anyone can view products; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view products" ON public.products FOR SELECT USING (true);


--
-- Name: store_settings Anyone can view public store settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view public store settings" ON public.store_settings FOR SELECT USING ((key = ANY (ARRAY['shipping_flat_rate'::text, 'free_shipping_threshold'::text, 'shipping_zones'::text, 'shipping_rate_table'::text, 'dispatch_city'::text, 'payfast_enabled'::text, 'about_hero_image'::text, 'about_place_image'::text])));


--
-- Name: orders Authenticated users can create their own orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can create their own orders" ON public.orders FOR INSERT TO authenticated WITH CHECK (((user_id = auth.uid()) AND ((length(COALESCE(customer_name, ''::text)) >= 2) AND (length(COALESCE(customer_name, ''::text)) <= 200)) AND (customer_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'::text) AND (length(COALESCE(customer_email, ''::text)) <= 320) AND ((length(COALESCE(customer_phone, ''::text)) >= 5) AND (length(COALESCE(customer_phone, ''::text)) <= 40)) AND ((length(COALESCE(address, ''::text)) >= 3) AND (length(COALESCE(address, ''::text)) <= 500)) AND ((length(COALESCE(city, ''::text)) >= 2) AND (length(COALESCE(city, ''::text)) <= 120)) AND ((length(COALESCE(postal_code, ''::text)) >= 3) AND (length(COALESCE(postal_code, ''::text)) <= 20)) AND (total_amount > (0)::numeric) AND (total_amount < (10000000)::numeric)));


--
-- Name: product_facets_cache Facets are public; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Facets are public" ON public.product_facets_cache FOR SELECT USING (true);


--
-- Name: home_showcase Home showcase is public; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Home showcase is public" ON public.home_showcase FOR SELECT USING (true);


--
-- Name: email_send_log Service role can insert send log; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can insert send log" ON public.email_send_log FOR INSERT TO service_role WITH CHECK (true);


--
-- Name: suppressed_emails Service role can insert suppressed emails; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can insert suppressed emails" ON public.suppressed_emails FOR INSERT TO service_role WITH CHECK (true);


--
-- Name: email_unsubscribe_tokens Service role can insert tokens; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can insert tokens" ON public.email_unsubscribe_tokens FOR INSERT TO service_role WITH CHECK (true);


--
-- Name: email_send_state Service role can manage send state; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can manage send state" ON public.email_send_state TO service_role USING (true) WITH CHECK (true);


--
-- Name: email_unsubscribe_tokens Service role can mark tokens as used; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can mark tokens as used" ON public.email_unsubscribe_tokens FOR UPDATE TO service_role USING (true) WITH CHECK (true);


--
-- Name: email_send_log Service role can read send log; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can read send log" ON public.email_send_log FOR SELECT TO service_role USING (true);


--
-- Name: suppressed_emails Service role can read suppressed emails; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can read suppressed emails" ON public.suppressed_emails FOR SELECT TO service_role USING (true);


--
-- Name: email_unsubscribe_tokens Service role can read tokens; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can read tokens" ON public.email_unsubscribe_tokens FOR SELECT TO service_role USING (true);


--
-- Name: email_send_log Service role can update send log; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can update send log" ON public.email_send_log FOR UPDATE TO service_role USING (true) WITH CHECK (true);


--
-- Name: ticket_messages Ticket owner or admin can create messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Ticket owner or admin can create messages" ON public.ticket_messages FOR INSERT TO authenticated WITH CHECK (((auth.uid() = sender_id) AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR (EXISTS ( SELECT 1
   FROM public.support_tickets t
  WHERE ((t.id = ticket_messages.ticket_id) AND (t.user_id = auth.uid()))))) AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR (COALESCE(is_admin, false) = false))));


--
-- Name: returns Users can create own returns; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create own returns" ON public.returns FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));


--
-- Name: support_tickets Users can create their own tickets; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create their own tickets" ON public.support_tickets FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));


--
-- Name: profiles Users can insert their own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert their own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));


--
-- Name: notifications Users can update own notifications read state; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own notifications read state" ON public.notifications FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: profiles Users can update their own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE TO authenticated USING ((auth.uid() = user_id));


--
-- Name: ticket_messages Users can view messages on their tickets; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view messages on their tickets" ON public.ticket_messages FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.support_tickets
  WHERE ((support_tickets.id = ticket_messages.ticket_id) AND (support_tickets.user_id = auth.uid())))));


--
-- Name: ai_conversations Users can view own conversations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own conversations" ON public.ai_conversations FOR SELECT TO authenticated USING ((auth.uid() = user_id));


--
-- Name: notifications Users can view own notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own notifications" ON public.notifications FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: order_items Users can view own order items, admins view all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own order items, admins view all" ON public.order_items FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR (EXISTS ( SELECT 1
   FROM public.orders
  WHERE ((orders.id = order_items.order_id) AND (orders.user_id = auth.uid()))))));


--
-- Name: orders Users can view own orders, admins view all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own orders, admins view all" ON public.orders FOR SELECT TO authenticated USING (((auth.uid() = user_id) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: returns Users can view own returns; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own returns" ON public.returns FOR SELECT TO authenticated USING ((auth.uid() = user_id));


--
-- Name: profiles Users can view their own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own profile" ON public.profiles FOR SELECT TO authenticated USING ((auth.uid() = user_id));


--
-- Name: user_roles Users can view their own roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own roles" ON public.user_roles FOR SELECT TO authenticated USING ((auth.uid() = user_id));


--
-- Name: support_tickets Users can view their own tickets; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own tickets" ON public.support_tickets FOR SELECT TO authenticated USING ((auth.uid() = user_id));


--
-- Name: addresses Users manage own addresses; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own addresses" ON public.addresses USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: notification_preferences Users manage own notification prefs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own notification prefs" ON public.notification_preferences USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: wishlists Users manage own wishlist; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own wishlist" ON public.wishlists USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: addresses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.addresses ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_conversations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_pulse_feed_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_pulse_feed_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_pulse_feeds; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_pulse_feeds ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_pulse_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_pulse_items ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_usage_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_usage_log ENABLE ROW LEVEL SECURITY;

--
-- Name: automation_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.automation_events ENABLE ROW LEVEL SECURITY;

--
-- Name: brands; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;

--
-- Name: categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

--
-- Name: compliance_access_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.compliance_access_log ENABLE ROW LEVEL SECURITY;

--
-- Name: compliance_documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.compliance_documents ENABLE ROW LEVEL SECURITY;

--
-- Name: data_retention_policy; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.data_retention_policy ENABLE ROW LEVEL SECURITY;

--
-- Name: email_send_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_send_log ENABLE ROW LEVEL SECURITY;

--
-- Name: email_send_state; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_send_state ENABLE ROW LEVEL SECURITY;

--
-- Name: email_unsubscribe_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_unsubscribe_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: engine_registry; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.engine_registry ENABLE ROW LEVEL SECURITY;

--
-- Name: engine_room_assessments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.engine_room_assessments ENABLE ROW LEVEL SECURITY;

--
-- Name: exchange_rates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.exchange_rates ENABLE ROW LEVEL SECURITY;

--
-- Name: home_showcase; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.home_showcase ENABLE ROW LEVEL SECURITY;

--
-- Name: image_blocklist; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.image_blocklist ENABLE ROW LEVEL SECURITY;

--
-- Name: newsletter_campaigns; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.newsletter_campaigns ENABLE ROW LEVEL SECURITY;

--
-- Name: newsletter_story_sends; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.newsletter_story_sends ENABLE ROW LEVEL SECURITY;

--
-- Name: newsletter_subscribers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.newsletter_subscribers ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_preferences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: order_audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: order_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

--
-- Name: orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

--
-- Name: payment_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;

--
-- Name: product_costs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_costs ENABLE ROW LEVEL SECURITY;

--
-- Name: product_facets_cache; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_facets_cache ENABLE ROW LEVEL SECURITY;

--
-- Name: products; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

--
-- Name: profile_admin_notes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profile_admin_notes ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: quote_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.quote_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: rate_limit_buckets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;

--
-- Name: returns; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.returns ENABLE ROW LEVEL SECURITY;

--
-- Name: security_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;

--
-- Name: sms_send_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sms_send_log ENABLE ROW LEVEL SECURITY;

--
-- Name: spend_caps; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.spend_caps ENABLE ROW LEVEL SECURITY;

--
-- Name: spend_ledger; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.spend_ledger ENABLE ROW LEVEL SECURITY;

--
-- Name: store_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.store_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: support_tickets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

--
-- Name: suppressed_emails; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.suppressed_emails ENABLE ROW LEVEL SECURITY;

--
-- Name: sync_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sync_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: threat_blocks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.threat_blocks ENABLE ROW LEVEL SECURITY;

--
-- Name: threat_quarantine; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.threat_quarantine ENABLE ROW LEVEL SECURITY;

--
-- Name: threat_signatures; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.threat_signatures ENABLE ROW LEVEL SECURITY;

--
-- Name: ticket_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ticket_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: user_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: wishlists; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.wishlists ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--


