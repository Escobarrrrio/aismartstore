-- ===========================================================================
-- The Engine Room, part 1: guardrails
-- ===========================================================================
--
-- The store already has a lot of monitoring -- SecurityModule, CostUsageModule,
-- EdgeFunctionHealthModule, SystemHealthModule, sync_logs, ai_usage_log. Every
-- one of them is a *mirror*. They tell you what already happened. Not one of
-- them can stop anything.
--
-- `ai_usage_log`'s own header says it plainly: CostUsageModule used to display
-- "a budget cap with no enforcement anywhere in the codebase". That is still
-- true today. If somebody found the public endpoints tonight and hammered the
-- SMS sender, the dashboards would render a beautiful, accurate, real-time
-- picture of the money leaving.
--
-- This migration is the half that says no. Three mechanisms, all enforced
-- server-side, all before the spend rather than after it:
--
--   1. rl_take()      a token bucket, so a single caller cannot repeat an
--                     expensive action faster than we are willing to pay for
--   2. spend_guard()  a per-provider daily and monthly rand ceiling, checked
--                     immediately before any billable external call
--   3. sec_log()      one place where refusals, anomalies and cap changes are
--                     recorded, so the engine room has something real to read
--
-- ---------------------------------------------------------------------------
-- ON "I SHOULDN'T BE ABLE TO ROB MYSELF"
-- ---------------------------------------------------------------------------
-- The caps deliberately bind the owner too, and in two specific ways:
--
--   * spend_guard() does not know or care who triggered the call. An
--     admin-initiated AI agent run is checked against exactly the same daily
--     ceiling as an anonymous chat message. There is no "admin bypass" flag,
--     because a bypass flag is the thing an attacker with a stolen admin
--     session would reach for first.
--
--   * The caps have a CHECK-constrained ceiling in the schema itself. An admin
--     can lower a cap freely and can raise it within the ceiling, but cannot
--     raise it past the ceiling from the UI at all -- that needs a migration,
--     which means a commit, a review and a deploy. A tired person at 2am
--     cannot turn R50/day into R50 000/day with one click, and neither can
--     anyone wearing their session.
--
-- Every write to spend_caps is logged with old and new values and the user who
-- did it, so a raise is at minimum visible even when it is legitimate.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Token bucket
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.rate_limit_buckets (
  bucket_key  text PRIMARY KEY,
  tokens      numeric     NOT NULL,
  last_refill timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;
-- No policies on purpose. Nothing reads this through PostgREST; only the
-- SECURITY DEFINER function below touches it. RLS on with zero policies is the
-- strongest default: an accidental grant later still yields nothing.

COMMENT ON TABLE public.rate_limit_buckets IS
  'Token buckets for rl_take(). One row per (action, identity). Not readable by any client role.';

CREATE OR REPLACE FUNCTION public.rl_take(
  p_key            text,
  p_capacity       numeric,
  p_refill_per_min numeric,
  p_cost           numeric DEFAULT 1
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
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
END $fn$;

COMMENT ON FUNCTION public.rl_take(text, numeric, numeric, numeric) IS
  'Atomic token bucket. Returns {allowed, remaining, retry_after_s}. Callers must treat allowed=false as a hard stop.';

REVOKE ALL ON FUNCTION public.rl_take(text, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rl_take(text, numeric, numeric, numeric) TO service_role;

-- Buckets are self-expiring: an untouched one is indistinguishable from a full
-- one, so old rows are garbage rather than state. Without this, one row per
-- attacking IP accumulates forever, which turns a rate limiter into a disk-fill
-- vector -- the attack it was installed to prevent, wearing a different hat.
CREATE OR REPLACE FUNCTION public.rl_sweep(p_older_than interval DEFAULT '2 days')
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE v_n integer;
BEGIN
  DELETE FROM public.rate_limit_buckets WHERE last_refill < now() - p_older_than;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $fn$;

REVOKE ALL ON FUNCTION public.rl_sweep(interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rl_sweep(interval) TO service_role;

-- 04:40, in the same quiet stretch as the other hygiene jobs. Unscheduled, the
-- sweep function exists and never runs, which is the same as not having it.
SELECT cron.schedule('rate-limit-bucket-sweep', '40 4 * * *', $cron$ SELECT public.rl_sweep(); $cron$)
WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rate-limit-bucket-sweep');


-- ---------------------------------------------------------------------------
-- 2. Spend caps
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.spend_caps (
  provider         text PRIMARY KEY,
  label            text        NOT NULL,
  daily_cap_zar    numeric(10,2) NOT NULL,
  monthly_cap_zar  numeric(10,2) NOT NULL,
  daily_call_cap   integer     NOT NULL,
  hard_stop        boolean     NOT NULL DEFAULT true,
  enabled          boolean     NOT NULL DEFAULT true,
  updated_at       timestamptz NOT NULL DEFAULT now(),

  -- The ceiling described in the header. These bounds are the part an admin
  -- cannot move; changing them requires a migration.
  CONSTRAINT spend_caps_daily_sane   CHECK (daily_cap_zar   >= 0 AND daily_cap_zar   <= 2000),
  CONSTRAINT spend_caps_monthly_sane CHECK (monthly_cap_zar >= 0 AND monthly_cap_zar <= 20000),
  CONSTRAINT spend_caps_calls_sane   CHECK (daily_call_cap  >= 0 AND daily_call_cap  <= 200000),
  -- A monthly cap below the daily cap is always a mistake, and a silent one:
  -- the daily number reads fine while the month stops on day one.
  CONSTRAINT spend_caps_monthly_ge_daily CHECK (monthly_cap_zar >= daily_cap_zar)
);

ALTER TABLE public.spend_caps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view spend caps"   ON public.spend_caps
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update spend caps" ON public.spend_caps
  FOR UPDATE USING (public.has_role(auth.uid(), 'admin'))
         WITH CHECK (public.has_role(auth.uid(), 'admin'));
-- Deliberately no INSERT or DELETE policy. Providers are added by migration.
-- Deleting a cap row is indistinguishable from raising it to infinity, so the
-- one operation that must not be one click away is the one nobody is granted.

CREATE TABLE IF NOT EXISTS public.spend_ledger (
  id          bigserial PRIMARY KEY,
  provider    text        NOT NULL,
  source      text        NOT NULL,
  units       numeric     NOT NULL DEFAULT 1,
  cost_zar    numeric(12,4) NOT NULL DEFAULT 0,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  meta        jsonb       NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.spend_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view spend ledger" ON public.spend_ledger
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

-- Every spend_guard() call filters on provider + occurred_at, twice (today and
-- month-to-date). This index is what keeps the guard cheap enough to sit in
-- front of a hot path.
CREATE INDEX IF NOT EXISTS spend_ledger_provider_time_idx
  ON public.spend_ledger (provider, occurred_at DESC);

COMMENT ON TABLE public.spend_ledger IS
  'One row per billable external call. cost_zar is 0 where a call is metered by count rather than money.';

-- Seed. Numbers chosen for a business whose next fixed payment is R4 000, not
-- for a funded startup: the caps should hurt slightly before they bankrupt.
INSERT INTO public.spend_caps (provider, label, daily_cap_zar, monthly_cap_zar, daily_call_cap, hard_stop) VALUES
  ('ai-gateway',   'AI gateway',      40.00,   600.00,   2000,  true),
  ('openai',       'OpenAI',                  40.00,   600.00,   2000,  true),
  ('telnyx-sms',   'Telnyx SMS (OTP)',        60.00,   700.00,    600,  true),
  ('resend-email', 'Transactional email',     30.00,   400.00,   5000,  true),
  ('axiz',         'Axiz distributor API',     0.00,     0.00,   8000,  true),
  ('courier-guy',  'Courier Guy tracking',     0.00,     0.00,   6000,  true),
  ('exchange-rates','FX rates',                0.00,     0.00,    200,  true)
ON CONFLICT (provider) DO NOTHING;

-- Telnyx gets the tightest money cap relative to its usefulness on purpose.
-- SMS is the one provider here that converts an unauthenticated HTTP request
-- directly into a per-message charge, which makes the OTP endpoint the single
-- most attractive thing on this domain to somebody who wants to cost us money
-- rather than steal from us. R60 is roughly 250 messages -- far above any real
-- day's signups, far below anything that matters if it all goes to an attacker.


CREATE OR REPLACE FUNCTION public.spend_guard(
  p_provider           text,
  p_estimated_cost_zar numeric DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
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
END $fn$;

COMMENT ON FUNCTION public.spend_guard(text, numeric) IS
  'Ask before spending. Returns allowed=false only when a cap is exceeded AND that cap is hard_stop. Applies to admin-triggered calls identically.';

REVOKE ALL ON FUNCTION public.spend_guard(text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.spend_guard(text, numeric) TO service_role;


CREATE OR REPLACE FUNCTION public.spend_record(
  p_provider text,
  p_source   text,
  p_units    numeric DEFAULT 1,
  p_cost_zar numeric DEFAULT 0,
  p_meta     jsonb   DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  INSERT INTO public.spend_ledger (provider, source, units, cost_zar, meta)
  VALUES (p_provider, p_source, coalesce(p_units, 1), coalesce(p_cost_zar, 0), coalesce(p_meta, '{}'::jsonb));
$fn$;

REVOKE ALL ON FUNCTION public.spend_record(text, text, numeric, numeric, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.spend_record(text, text, numeric, numeric, jsonb) TO service_role;


-- ---------------------------------------------------------------------------
-- 3. Security events
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.security_events (
  id         bigserial PRIMARY KEY,
  kind       text        NOT NULL,
  severity   text        NOT NULL DEFAULT 'info'
             CHECK (severity IN ('info', 'low', 'medium', 'high', 'critical')),
  actor      text,
  detail     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view security events" ON public.security_events
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
-- No INSERT policy, no UPDATE, no DELETE, for anybody. Writes go through
-- sec_log() only, and an audit log an admin session can edit is not an audit
-- log -- it is a diary that the person under investigation is holding.

CREATE INDEX IF NOT EXISTS security_events_time_idx     ON public.security_events (created_at DESC);
CREATE INDEX IF NOT EXISTS security_events_severity_idx ON public.security_events (severity, created_at DESC);

CREATE OR REPLACE FUNCTION public.sec_log(
  p_kind     text,
  p_severity text  DEFAULT 'info',
  p_actor    text  DEFAULT NULL,
  p_detail   jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  INSERT INTO public.security_events (kind, severity, actor, detail)
  VALUES (p_kind, coalesce(p_severity, 'info'), p_actor, coalesce(p_detail, '{}'::jsonb));
$fn$;

REVOKE ALL ON FUNCTION public.sec_log(text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sec_log(text, text, text, jsonb) TO service_role;


-- Every cap change is recorded, including the ones that are entirely
-- legitimate. A raise that nobody can see afterwards is the same shape as a
-- raise nobody authorised.
CREATE OR REPLACE FUNCTION public.audit_spend_cap_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
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
END $fn$;

DROP TRIGGER IF EXISTS spend_caps_audit ON public.spend_caps;
CREATE TRIGGER spend_caps_audit
  BEFORE UPDATE ON public.spend_caps
  FOR EACH ROW EXECUTE FUNCTION public.audit_spend_cap_change();


-- ---------------------------------------------------------------------------
-- 4. Engine registry
-- ---------------------------------------------------------------------------
--
-- Health is currently inferred by reading whichever log a given module happens
-- to know about. That misses the failure mode that matters most: an engine
-- that is not failing because it is not running at all. Nothing raises an
-- alarm about silence unless something first wrote down what silence means.
--
-- max_silence_minutes is that number, per engine, and it is generous relative
-- to the cadence -- roughly two-and-a-bit missed runs -- so a single skipped
-- tick is not an alert and a genuinely stopped engine is.

CREATE TABLE IF NOT EXISTS public.engine_registry (
  engine_key          text PRIMARY KEY,
  label               text    NOT NULL,
  kind                text    NOT NULL CHECK (kind IN ('sync', 'content', 'commerce', 'hygiene', 'comms')),
  log_source          text,            -- matches sync_logs.source, when it logs there
  cron_job_name       text,            -- matches cron.job.jobname, when it is scheduled
  cadence             text    NOT NULL,
  max_silence_minutes integer NOT NULL,
  critical            boolean NOT NULL DEFAULT false,
  notes               text
);

ALTER TABLE public.engine_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view engine registry" ON public.engine_registry
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.engine_registry
  (engine_key, label, kind, log_source, cron_job_name, cadence, max_silence_minutes, critical, notes) VALUES
  ('axiz-sync', 'Axiz catalogue sync', 'sync', 'axiz', 'axiz-sync',
   'every 15 min', 45, true,
   'Prices and stock. Silence here means the storefront is quoting yesterday.'),
  ('sync-courier-tracking', 'Courier tracking', 'sync', 'sync-courier-tracking', 'sync-courier-tracking',
   'every 30 min', 90, true,
   'Customers watching a parcel notice this stopping before we do.'),
  ('sync-ai-pulse', 'AI Pulse ingestion', 'content', 'sync-ai-pulse', 'sync-ai-pulse-every-6h',
   'every 6 hours', 900, false, NULL),
  ('ai-pulse-enqueue-feeds', 'AI Pulse feed fetch', 'content', NULL, 'ai-pulse-enqueue-feeds',
   'every 3 hours', 450, false, 'SQL-native African feed ingestion via pg_net.'),
  ('ai-pulse-ingest-feeds', 'AI Pulse feed parse', 'content', NULL, 'ai-pulse-ingest-feeds',
   'every 3 hours', 450, false, NULL),
  ('ai-pulse-daily-digest', 'AI Pulse daily digest', 'comms', NULL, 'ai-pulse-daily-digest',
   'daily 03:30', 2160, false, 'Builds the digest subscribers receive.'),
  ('refresh-home-showcase', 'Home merchandising', 'commerce', NULL, 'refresh-home-showcase',
   'every 3 hours', 450, true,
   'The ranked home page. Stale here is a quiet revenue leak, not an error.'),
  ('refresh-product-facets', 'Search facets', 'commerce', NULL, 'refresh-product-facets',
   'hourly', 180, false, NULL),
  ('stock-sanity-check', 'Stock sanity', 'hygiene', 'stock-sanity-check', 'stock-sanity-check-hourly',
   'hourly', 180, true, 'Catches mispriced and impossible stock states before a customer buys one.'),
  ('cleanup-blocked-products', 'Blocked image sweep', 'hygiene', 'cleanup-blocked-products', 'cleanup-blocked-products-daily',
   'daily 04:00', 2160, false, NULL),
  ('sync-exchange-rates', 'FX rates', 'sync', 'sync-exchange-rates', 'sync-exchange-rates-daily',
   'daily 03:00', 2160, false, NULL)
ON CONFLICT (engine_key) DO NOTHING;


-- ---------------------------------------------------------------------------
-- 5. One read for the whole room
-- ---------------------------------------------------------------------------
--
-- The admin UI needs engines, spend, security and cron in one view. Seven
-- round trips to build one screen is seven chances for a partial render that
-- reads as "everything is fine" because the failing half has not arrived yet.
-- One RPC, one answer, one timestamp.

CREATE OR REPLACE FUNCTION public.engine_room_snapshot()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_engines  jsonb;
  v_spend    jsonb;
  v_security jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501';
  END IF;

  WITH runs AS (
    SELECT r.*,
           -- Two engines write two different diaries. The ones that go through
           -- an edge function log to sync_logs with rich detail; the ones that
           -- are pure SQL called straight from pg_cron leave no application log
           -- at all, and their only trace is cron.job_run_details. Reading only
           -- the first would report every SQL-native engine as 'unknown'
           -- forever -- eleven engines, five of which would be permanently
           -- greyed out and quickly ignored, which is how a real outage gets
           -- missed in a room full of grey.
           coalesce(l.started_at, c.start_time)                       AS last_run,
           coalesce(l.status, c.status)                               AS last_status,
           left(coalesce(l.error_details, c.return_message, ''), 240) AS last_error,
           l.items_synced, l.items_failed
      FROM public.engine_registry r
      LEFT JOIN LATERAL (
        -- error_details is really a run summary: axiz-sync writes its cursor
        -- position and counts there on a perfectly good run. Surfacing it
        -- unconditionally would paint every healthy engine with what reads as
        -- an error message, and a dashboard where everything looks slightly
        -- broken is one nobody trusts enough to act on.
        SELECT s.started_at, s.status, s.items_synced, s.items_failed,
               CASE WHEN s.status = 'success' THEN NULL ELSE s.error_details END AS error_details
          FROM public.sync_logs s
         WHERE r.log_source IS NOT NULL AND s.source = r.log_source
         ORDER BY s.started_at DESC
         LIMIT 1
      ) l ON true
      LEFT JOIN LATERAL (
        -- Same for pg_cron: return_message on a successful run is the row
        -- count ("1 row"), not a complaint.
        SELECT d.start_time,
               CASE WHEN d.status = 'succeeded' THEN 'success' ELSE 'failed' END AS status,
               CASE WHEN d.status = 'succeeded' THEN NULL ELSE d.return_message END AS return_message
          FROM cron.job_run_details d
          JOIN cron.job j ON j.jobid = d.jobid
         WHERE r.cron_job_name IS NOT NULL AND j.jobname = r.cron_job_name
         ORDER BY d.start_time DESC
         LIMIT 1
      ) c ON true
  ), graded AS (
    SELECT runs.*,
           CASE
             -- An engine that has stopped ranks worse than one that is failing
             -- loudly: a failing engine is at least still trying, and is
             -- already in somebody's logs. Silence is the state nothing else
             -- in this codebase notices.
             WHEN last_run IS NULL THEN 'unknown'
             WHEN last_run < now() - make_interval(mins => max_silence_minutes) THEN 'stalled'
             WHEN last_status = 'partial'          THEN 'degraded'
             WHEN last_status IN ('error','failed') THEN 'failing'
             WHEN last_status = 'running'          THEN 'running'
             WHEN last_status = 'success'          THEN 'ok'
             ELSE 'unknown'
           END AS status
      FROM runs
  )
  SELECT jsonb_agg(
           jsonb_build_object(
             'key', engine_key, 'label', label, 'kind', kind,
             'cadence', cadence, 'critical', critical, 'notes', notes,
             'last_run', last_run, 'last_status', last_status, 'last_error', last_error,
             'items_synced', items_synced, 'items_failed', items_failed,
             'minutes_silent', CASE WHEN last_run IS NULL THEN NULL
                                    ELSE floor(extract(epoch FROM (now() - last_run)) / 60)::int END,
             'status', status)
           -- Worst first, and critical ahead of non-critical within a grade.
           -- Sorting on the status text itself would have put 'unknown' above
           -- 'stalled' and 'ok' above 'failing', purely alphabetically.
           ORDER BY CASE status
                      WHEN 'stalled'  THEN 0 WHEN 'failing' THEN 1
                      WHEN 'degraded' THEN 2 WHEN 'unknown' THEN 3
                      WHEN 'running'  THEN 4 ELSE 5 END,
                    critical DESC, label)
    INTO v_engines
    FROM graded;

  SELECT jsonb_agg(jsonb_build_object(
           'provider', c.provider, 'label', c.label,
           'daily_cap', c.daily_cap_zar, 'monthly_cap', c.monthly_cap_zar,
           'call_cap', c.daily_call_cap, 'hard_stop', c.hard_stop, 'enabled', c.enabled,
           'spent_today', round(coalesce(d.spent, 0), 2),
           'calls_today', coalesce(d.calls, 0),
           'spent_month', round(coalesce(m.spent, 0), 2),
           'pct_daily', CASE WHEN c.daily_cap_zar > 0
                             THEN round(coalesce(d.spent, 0) / c.daily_cap_zar * 100)
                             WHEN c.daily_call_cap > 0
                             THEN round(coalesce(d.calls, 0)::numeric / c.daily_call_cap * 100)
                             ELSE 0 END)
         ORDER BY c.label)
    INTO v_spend
    FROM public.spend_caps c
    LEFT JOIN LATERAL (
      SELECT sum(cost_zar) AS spent, count(*) AS calls
        FROM public.spend_ledger
       WHERE provider = c.provider
         AND occurred_at >= date_trunc('day', now() AT TIME ZONE 'Africa/Johannesburg')
                              AT TIME ZONE 'Africa/Johannesburg'
    ) d ON true
    LEFT JOIN LATERAL (
      SELECT sum(cost_zar) AS spent
        FROM public.spend_ledger
       WHERE provider = c.provider
         AND occurred_at >= date_trunc('month', now() AT TIME ZONE 'Africa/Johannesburg')
                              AT TIME ZONE 'Africa/Johannesburg'
    ) m ON true;

  SELECT jsonb_build_object(
           'last_24h', (SELECT count(*) FROM public.security_events WHERE created_at > now() - interval '24 hours'),
           'high_24h', (SELECT count(*) FROM public.security_events
                         WHERE created_at > now() - interval '24 hours'
                           AND severity IN ('high', 'critical')),
           'recent', coalesce((
             SELECT jsonb_agg(jsonb_build_object(
                      'kind', kind, 'severity', severity, 'actor', actor,
                      'detail', detail, 'at', created_at) ORDER BY created_at DESC)
               FROM (SELECT * FROM public.security_events ORDER BY created_at DESC LIMIT 40) s
           ), '[]'::jsonb))
    INTO v_security;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'engines',  coalesce(v_engines, '[]'::jsonb),
    'spend',    coalesce(v_spend, '[]'::jsonb),
    'security', v_security);
END $fn$;

COMMENT ON FUNCTION public.engine_room_snapshot() IS
  'Everything the Engine Room renders, in one admin-only call. Raises 42501 for non-admins rather than returning an empty shell.';

REVOKE ALL ON FUNCTION public.engine_room_snapshot() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.engine_room_snapshot() TO authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 6. Table privileges
-- ---------------------------------------------------------------------------
--
-- Not decoration, and not redundant with the RLS policies above.
--
-- This database's default privileges hand every newly created table in `public`
-- the full set -- SELECT, INSERT, UPDATE, DELETE, TRUNCATE -- to both `anon` and
-- `authenticated`. RLS then narrows almost all of it back down, which is why
-- everything above still behaves correctly.
--
-- Almost. **TRUNCATE is not subject to row-level security.** A role holding
-- TRUNCATE can empty a table regardless of how restrictive its policies are.
-- Left as it was, `anon` held TRUNCATE on `security_events` -- so the comment a
-- few dozen lines up, promising an audit log nobody can edit or delete, would
-- have been false in the one way that matters most: the log an attacker most
-- wants gone is exactly the log recording what they did.
--
-- PostgREST does not expose TRUNCATE, so this was latent rather than live. It
-- is still a privilege that should never have been held, and a claim in a
-- comment is worth what the grants behind it are worth.
--
-- So: revoke everything, then grant back only what each role genuinely needs,
-- and let RLS narrow that further.
REVOKE ALL ON public.rate_limit_buckets, public.spend_caps, public.spend_ledger,
              public.security_events, public.engine_registry
  FROM anon, authenticated;

-- `authenticated` gets read only -- and RLS narrows that to admins. spend_caps
-- also gets UPDATE, because the Engine Room's cap dials are a normal PostgREST
-- update from the browser; the CHECK constraints and the audit trigger are what
-- bound that, not the absence of the privilege.
GRANT SELECT ON public.spend_caps, public.spend_ledger, public.security_events,
                public.engine_registry TO authenticated;
GRANT UPDATE ON public.spend_caps TO authenticated;

-- `rate_limit_buckets` is granted to nobody but service_role. Nothing reads it
-- through the API, and its contents are a live map of who is currently being
-- throttled.
GRANT ALL ON public.rate_limit_buckets, public.spend_caps, public.spend_ledger,
             public.security_events, public.engine_registry TO service_role;
-- SECURITY DEFINER with an explicit has_role() check inside, rather than
-- SECURITY INVOKER: the function reads sync_logs and cron state that admins
-- have no direct table grants on. The check is the first statement in the body
-- so there is no path that reads anything before establishing who is asking.
