-- ===========================================================================
-- The Engine Room, part 3: bots, spam, phishing, and fighting back
-- ===========================================================================
--
-- WHY THIS IS IN THE DATABASE AND NOT IN AN EDGE FUNCTION
-- -------------------------------------------------------
-- This is the decision the whole design turns on.
--
-- The two doors an anonymous visitor can write through -- newsletter signup and
-- the business quote form -- do not go through an edge function at all. The
-- browser posts them straight to PostgREST against an RLS policy. A TypeScript
-- guard in `_shared/` would sit beside that path and never see a single
-- request; an attacker does not have to evade it, only to skip it, which is
-- what the ordinary client already does.
--
-- So the check lives where the write lands: BEFORE INSERT triggers. There is no
-- path to those tables that avoids them -- not PostgREST, not an edge function,
-- not a stray service-role script.
--
-- WHAT IT LOOKS FOR
-- -----------------
--   phishing   credential-harvest language, urgent-action framing, link
--              shorteners, raw IP URLs, punycode and mixed-script homographs
--   spam       link stuffing, SEO junk, the pharma/casino/crypto vocabulary,
--              gibberish keyboard-mashing
--   injection  SQL and script payloads in free-text fields
--   bot        velocity: the same address, domain or content arriving faster
--              than a human types
--
-- FIGHTING BACK, WITHOUT SHOOTING CUSTOMERS
-- ------------------------------------------
-- "Block on first sight" is the ask, and taken literally it is the most
-- expensive possible feature: every false positive is a lost customer who sees
-- an error, assumes the site is broken, and leaves. A quote form that rejects a
-- real R400 000 tender enquiry because it contained the word "urgent" has cost
-- more than every bot it ever stopped.
--
-- So the response is graduated and every step is reversible:
--
--   score < 40    allowed, nothing recorded -- ordinary traffic
--   40 to 69      allowed, recorded as suspicious. The owner sees it in the
--                 Engine Room and it counts towards velocity. Nobody is turned
--                 away on a maybe.
--   70+           quarantined -- the submission is kept whole and reviewable,
--                 the sender is blocked for a spell that doubles with each
--                 repeat offence, and nothing is said to the sender
--
-- Blocks expire on their own, are listed in the Engine Room, and can be cleared
-- with one call. A permanent block nobody can see is a customer complaint
-- arriving three weeks later with no way to explain it.
--
-- Signed-in customers who have actually ordered are never auto-blocked on
-- content alone. Someone who has given us money has earned the benefit of the
-- doubt over a regex.
--
-- The signature table is data, not code, so a new pattern is one INSERT rather
-- than a migration and a deploy. That matters when something is happening now.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Signatures
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.threat_signatures (
  id          bigserial PRIMARY KEY,
  category    text    NOT NULL CHECK (category IN ('phishing','spam','injection','bot')),
  label       text    NOT NULL,
  pattern     text    NOT NULL,     -- POSIX regex, matched case-insensitively
  weight      integer NOT NULL CHECK (weight BETWEEN 1 AND 100),
  enabled     boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.threat_signatures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view threat signatures" ON public.threat_signatures
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

-- Weights are calibrated so no single signal can reject on its own except the
-- ones that have no innocent reading. A real enquiry can say "urgent" (25); it
-- does not also contain a link shortener and a raw-IP URL.
INSERT INTO public.threat_signatures (category, label, pattern, weight) VALUES
  -- Phishing: the language of credential harvesting.
  ('phishing','Credential request',    '(verify|confirm|update|validate)[[:space:]]+(your[[:space:]]+)?(account|password|identity|banking|card)', 45),
  ('phishing','Account suspension',    '(account|access)[[:space:]]+(has[[:space:]]+been[[:space:]]+)?(suspended|locked|disabled|terminated|restricted)', 40),
  ('phishing','Urgent action framing', '(urgent|immediate|within[[:space:]]+24[[:space:]]+hours|act[[:space:]]+now|final[[:space:]]+notice)', 25),
  ('phishing','Link shortener',        '\y(bit\.ly|tinyurl|goo\.gl|t\.co|ow\.ly|is\.gd|buff\.ly|rb\.gy|cutt\.ly|shorturl)', 50),
  ('phishing','Raw IP address URL',    'https?://[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}', 55),
  ('phishing','Punycode domain',       'xn--', 45),
  ('phishing','Credentials in text',   '(password|passwd|pin[[:space:]]+code|otp|one[[:space:]]*time[[:space:]]*pin)[[:space:]]*[:=]', 50),
  ('phishing','Wire transfer lure',    '(wire[[:space:]]+transfer|western[[:space:]]+union|money[[:space:]]*gram|bitcoin[[:space:]]+wallet|crypto[[:space:]]+wallet)', 45),
  ('phishing','Impersonating us',      '(aismartstore|ai[[:space:]]+smart[[:space:]]+store)[[:space:]]+(support|security|billing)[[:space:]]+team', 60),

  -- Spam: what a scraper-driven form filler leaves behind.
  ('spam','Link stuffing',             '(https?://[^[:space:]]+[[:space:]]*){4,}', 50),
  ('spam','SEO backlink pitch',        '(seo|backlink|guest[[:space:]]+post|link[[:space:]]+building|domain[[:space:]]+authority|first[[:space:]]+page[[:space:]]+of[[:space:]]+google)', 45),
  ('spam','Pharma',                    '\y(viagra|cialis|tramadol|oxycontin|xanax|phentermine)\y', 60),
  ('spam','Gambling',                  '\y(casino|betting[[:space:]]+site|slots[[:space:]]+online|poker[[:space:]]+bonus|sportsbook)\y', 45),
  ('spam','Crypto pitch',              '(forex[[:space:]]+trading|binary[[:space:]]+option|crypto[[:space:]]+invest|guaranteed[[:space:]]+returns|passive[[:space:]]+income)', 45),
  ('spam','Adult',                     '\y(porn|xxx[[:space:]]+video|escort[[:space:]]+service|webcam[[:space:]]+girl)\y', 55),
  ('spam','BBCode/HTML injection',     '(\[url=|\[/url\]|<a[[:space:]]+href)', 40),
  ('spam','Keyboard mash',             '(asdf|qwer|zxcv|hjkl){2,}', 50),

  -- Injection: no innocent reading of any of these in a contact form.
  ('injection','SQL union select',     'union[[:space:]]+(all[[:space:]]+)?select', 70),
  ('injection','SQL tautology',        '(''|")[[:space:]]*(or|and)[[:space:]]+(''|")?[0-9]+[[:space:]]*=[[:space:]]*[0-9]+', 70),
  ('injection','SQL comment escape',   '(--[[:space:]]|/\*|;[[:space:]]*drop[[:space:]]|;[[:space:]]*delete[[:space:]])', 65),
  ('injection','Script tag',           '<[[:space:]]*script', 70),
  ('injection','Event handler',        'on(error|load|click|mouseover)[[:space:]]*=', 60),
  ('injection','JS protocol',          'javascript[[:space:]]*:', 65),
  ('injection','Template injection',   '(\{\{.*\}\}|\$\{.*\})', 45),
  ('injection','Path traversal',       '(\.\./){2,}', 60),
  ('injection','Server-side include',  '<!--#(exec|include)', 70)
ON CONFLICT DO NOTHING;


-- ---------------------------------------------------------------------------
-- 2. Blocks
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.threat_blocks (
  block_key   text PRIMARY KEY,          -- 'email:x@y.z' or 'domain:y.z'
  reason      text        NOT NULL,
  category    text        NOT NULL,
  score       integer     NOT NULL,
  offences    integer     NOT NULL DEFAULT 1,
  blocked_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  detail      jsonb       NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.threat_blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view threat blocks"   ON public.threat_blocks
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can clear threat blocks"  ON public.threat_blocks
  FOR DELETE USING (public.has_role(auth.uid(), 'admin'));
-- Admins can clear a block but cannot create one by hand. A block is a
-- consequence of evidence recorded in security_events; one typed straight into
-- the table would have no evidence behind it and nothing to review later.

CREATE INDEX IF NOT EXISTS threat_blocks_expiry_idx ON public.threat_blocks (expires_at);

-- Default privileges on this database hand every new public table the full set
-- to anon and authenticated, and TRUNCATE ignores RLS entirely -- see
-- 20260730180000. Revoke first, grant back deliberately.
REVOKE ALL   ON public.threat_signatures, public.threat_blocks FROM anon, authenticated;
GRANT SELECT ON public.threat_signatures, public.threat_blocks TO authenticated;
GRANT DELETE ON public.threat_blocks TO authenticated;
GRANT ALL    ON public.threat_signatures, public.threat_blocks TO service_role;


-- ---------------------------------------------------------------------------
-- 3. Scoring
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.threat_score(p_text text)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path = public, pg_temp
AS $fn$
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
END $fn$;

COMMENT ON FUNCTION public.threat_score(text) IS
  'Scores free text 0-100 for phishing, spam and injection. Normalises zero-width and whitespace evasion before matching.';


-- ---------------------------------------------------------------------------
-- 4. Blocking
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.threat_is_blocked(p_key text)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.threat_blocks
                  WHERE block_key = p_key AND expires_at > now());
$fn$;

CREATE OR REPLACE FUNCTION public.threat_block(
  p_key text, p_reason text, p_category text, p_score integer, p_detail jsonb DEFAULT '{}'::jsonb
) RETURNS timestamptz
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
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
END $fn$;

REVOKE ALL ON FUNCTION public.threat_block(text, text, text, integer, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.threat_block(text, text, text, integer, jsonb) TO service_role;

-- Expired rows are noise, not history -- security_events keeps the record of
-- what happened. Swept with the rate-limit buckets.
CREATE OR REPLACE FUNCTION public.threat_sweep()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE v_n integer;
BEGIN
  DELETE FROM public.threat_blocks WHERE expires_at < now() - interval '7 days';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $fn$;

REVOKE ALL ON FUNCTION public.threat_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.threat_sweep() TO service_role;




-- ---------------------------------------------------------------------------
-- 5. Quarantine
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.threat_quarantine (
  id         bigserial PRIMARY KEY,
  surface    text    NOT NULL,
  email      text,
  score      integer NOT NULL,
  category   text    NOT NULL,
  payload    jsonb   NOT NULL,          -- the whole submission, kept intact
  hits       jsonb   NOT NULL DEFAULT '[]'::jsonb,
  released   boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.threat_quarantine ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view quarantine" ON public.threat_quarantine
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX IF NOT EXISTS threat_quarantine_time_idx ON public.threat_quarantine (created_at DESC);

REVOKE ALL   ON public.threat_quarantine FROM anon, authenticated;
GRANT SELECT ON public.threat_quarantine TO authenticated;
GRANT ALL    ON public.threat_quarantine TO service_role;
-- anon needs the sequence: the trigger runs as the inserting role, and the
-- inserting role on these tables is anon.
GRANT USAGE, SELECT ON SEQUENCE public.threat_quarantine_id_seq TO service_role, authenticated, anon;


-- ---------------------------------------------------------------------------
-- 6. The gate
-- ---------------------------------------------------------------------------
--
-- Returns a verdict rather than raising. The trigger drops the row by returning
-- NULL when the verdict is against it.
--
-- THE FIRST VERSION RAISED, AND IT WAS WRONG IN A WAY THAT LOOKED RIGHT
-- ---------------------------------------------------------------------
-- RAISE EXCEPTION aborts the transaction -- and threat_block() and sec_log()
-- had already written *inside* that transaction, so every block was rolled back
-- the instant it was decided. The engine refused each attack and remembered
-- none of them: no escalation, no repeat-offender doubling, nothing in the
-- Engine Room, and an attacker free to retry forever at the same cost.
--
-- Every test passed except the one that came back a second time.
--
-- Quarantining fixes that, and is better behaviour regardless -- for the same
-- reason mail systems file spam rather than bouncing it:
--
--   * the transaction commits, so the block persists and offences accumulate
--   * the sender is told nothing, so they cannot tune against the scorer by
--     watching which payloads produce an error
--   * a false positive is recoverable. The submission is kept whole and shown
--     in the Engine Room, instead of being an error message a real customer
--     saw once and walked away from
--
-- The cost is that a blocked sender believes they succeeded. For a bot that is
-- the point. For the rare misjudged human it is the reason the quarantine is
-- reviewable rather than a delete.

CREATE OR REPLACE FUNCTION public.threat_gate(
  p_surface text,
  p_email   text,
  p_content text,
  p_detail  jsonb   DEFAULT '{}'::jsonb,
  p_bonus   integer DEFAULT 0
) RETURNS boolean               -- true = let the row through, false = quarantine
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
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
END $fn$;

REVOKE ALL ON FUNCTION public.threat_gate(text, text, text, jsonb, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.threat_gate(text, text, text, jsonb, integer) TO anon, authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 7. Wiring it to the doors
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tg_threat_newsletter()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
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
END $fn$;

DROP TRIGGER IF EXISTS threat_gate_newsletter ON public.newsletter_subscribers;
CREATE TRIGGER threat_gate_newsletter
  BEFORE INSERT ON public.newsletter_subscribers
  FOR EACH ROW EXECUTE FUNCTION public.tg_threat_newsletter();

CREATE OR REPLACE FUNCTION public.tg_threat_quote()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF public.threat_gate('quote', NEW.email,
       concat_ws(' ', NEW.organisation_name, NEW.contact_name, NEW.email, NEW.phone, NEW.requirements),
       jsonb_build_object('organisation', NEW.organisation_name, 'contact_name', NEW.contact_name,
                          'email', NEW.email, 'phone', NEW.phone, 'requirements', NEW.requirements),
       0)
  THEN RETURN NEW; ELSE RETURN NULL; END IF;
END $fn$;

DROP TRIGGER IF EXISTS threat_gate_quote ON public.quote_requests;
CREATE TRIGGER threat_gate_quote
  BEFORE INSERT ON public.quote_requests
  FOR EACH ROW EXECUTE FUNCTION public.tg_threat_quote();


-- ---------------------------------------------------------------------------
-- 8. Into the Engine Room
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.threat_summary()
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $fn$
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
$fn$;

REVOKE ALL ON FUNCTION public.threat_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.threat_summary() TO authenticated, service_role;

-- Clearing a block is a deliberate, logged act. Exposed as a function rather
-- than left to a raw DELETE so the reversal is recorded next to the block --
-- otherwise a cleared block looks, in the log, exactly like one that expired.
CREATE OR REPLACE FUNCTION public.threat_unblock(p_key text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
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
END $fn$;

REVOKE ALL ON FUNCTION public.threat_unblock(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.threat_unblock(text) TO authenticated, service_role;

-- Expired blocks are swept alongside the rate-limit buckets. Replaces the
-- single-purpose job created in 20260730160000.
DO $$
BEGIN
  PERFORM cron.unschedule('rate-limit-bucket-sweep');
EXCEPTION WHEN OTHERS THEN NULL;   -- not scheduled on a fresh database
END $$;

SELECT cron.schedule('guardrail-sweep', '40 4 * * *',
  $cron$ SELECT public.rl_sweep(); SELECT public.threat_sweep(); $cron$)
WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'guardrail-sweep');
