-- ===========================================================================
-- The Engine Room, part 2: the watch
-- ===========================================================================
--
-- Part 1 gave the room instruments and brakes. This is the thing that reads
-- the instruments while nobody is looking, decides whether it matters, and
-- says so out loud.
--
-- HOW THE AI IS AND IS NOT USED
-- -----------------------------
-- The severity call is made by deterministic rules in the edge function, not
-- by the model. The model writes the explanation.
--
-- That split is the whole design. An AI-judged monitor has two failure modes
-- that a small business cannot absorb: it stops working exactly when the AI
-- budget is exhausted -- which is the precise moment something is wrong -- and
-- its verdict cannot be reproduced or argued with afterwards. Rules decide;
-- the model makes the decision readable. If the model is unavailable, capped,
-- or wrong, the alert still fires and still carries the findings.
--
-- The analyst is also subject to the same spend_guard() as everything else, so
-- the watchman cannot be the thing that empties the till.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.engine_room_assessments (
  id           bigserial PRIMARY KEY,
  severity     text        NOT NULL CHECK (severity IN ('ok', 'notice', 'warning', 'critical')),
  headline     text        NOT NULL,
  -- The rule output. This is the part that is always populated, always
  -- reproducible from the same snapshot, and the part alerting keys off.
  findings     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  -- The model's prose. Null whenever the model was unavailable or capped,
  -- which must stay visibly different from "the model had nothing to say".
  narrative    text,
  ai_model     text,
  snapshot     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  alert_sent   boolean     NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.engine_room_assessments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view assessments" ON public.engine_room_assessments
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS engine_room_assessments_time_idx
  ON public.engine_room_assessments (created_at DESC);

-- Revoke first. This database's default privileges grant every new public table
-- the full set to anon and authenticated, and TRUNCATE among them is not subject
-- to RLS -- see the note in 20260730160000. An assessment history that can be
-- emptied is not a history.
REVOKE ALL   ON public.engine_room_assessments FROM anon, authenticated;
GRANT SELECT ON public.engine_room_assessments TO authenticated;
GRANT ALL    ON public.engine_room_assessments TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.engine_room_assessments_id_seq TO service_role;


-- The analyst reads the same snapshot the admin screen does, so there is
-- exactly one definition of the room's state and no chance of the alert and
-- the dashboard disagreeing about what happened.
--
-- It runs as service_role, which has no auth.uid(), so the admin check needs a
-- second arm. auth.role() reads the caller's JWT claim rather than the current
-- database role -- which matters here, because inside a SECURITY DEFINER
-- function current_user is the function's *owner*, not the caller. Checking
-- current_user would have granted this to everyone.
CREATE OR REPLACE FUNCTION public.engine_room_snapshot()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $fn$
DECLARE
  v_engines jsonb; v_spend jsonb; v_security jsonb;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR coalesce(auth.role(), '') = 'service_role') THEN
    RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501';
  END IF;

  WITH runs AS (
    SELECT r.*,
           coalesce(l.started_at, c.start_time)                       AS last_run,
           coalesce(l.status, c.status)                               AS last_status,
           left(coalesce(l.error_details, c.return_message, ''), 240) AS last_error,
           l.items_synced, l.items_failed
      FROM public.engine_registry r
      LEFT JOIN LATERAL (
        SELECT s.started_at, s.status, s.items_synced, s.items_failed,
               CASE WHEN s.status = 'success' THEN NULL ELSE s.error_details END AS error_details
          FROM public.sync_logs s
         WHERE r.log_source IS NOT NULL AND s.source = r.log_source
         ORDER BY s.started_at DESC LIMIT 1
      ) l ON true
      LEFT JOIN LATERAL (
        SELECT d.start_time,
               CASE WHEN d.status = 'succeeded' THEN 'success' ELSE 'failed' END AS status,
               CASE WHEN d.status = 'succeeded' THEN NULL ELSE d.return_message END AS return_message
          FROM cron.job_run_details d JOIN cron.job j ON j.jobid = d.jobid
         WHERE r.cron_job_name IS NOT NULL AND j.jobname = r.cron_job_name
         ORDER BY d.start_time DESC LIMIT 1
      ) c ON true
  ), graded AS (
    SELECT runs.*,
           CASE
             WHEN last_run IS NULL THEN 'unknown'
             WHEN last_run < now() - make_interval(mins => max_silence_minutes) THEN 'stalled'
             WHEN last_status = 'partial'           THEN 'degraded'
             WHEN last_status IN ('error','failed') THEN 'failing'
             WHEN last_status = 'running'           THEN 'running'
             WHEN last_status = 'success'           THEN 'ok'
             ELSE 'unknown'
           END AS status
      FROM runs
  )
  SELECT jsonb_agg(jsonb_build_object(
           'key', engine_key, 'label', label, 'kind', kind,
           'cadence', cadence, 'critical', critical, 'notes', notes,
           'last_run', last_run, 'last_status', last_status, 'last_error', last_error,
           'items_synced', items_synced, 'items_failed', items_failed,
           'minutes_silent', CASE WHEN last_run IS NULL THEN NULL
                                  ELSE floor(extract(epoch FROM (now() - last_run)) / 60)::int END,
           'status', status)
         ORDER BY CASE status WHEN 'stalled' THEN 0 WHEN 'failing' THEN 1
                              WHEN 'degraded' THEN 2 WHEN 'unknown' THEN 3
                              WHEN 'running' THEN 4 ELSE 5 END,
                  critical DESC, label)
    INTO v_engines FROM graded;

  SELECT jsonb_agg(jsonb_build_object(
           'provider', c.provider, 'label', c.label,
           'daily_cap', c.daily_cap_zar, 'monthly_cap', c.monthly_cap_zar,
           'call_cap', c.daily_call_cap, 'hard_stop', c.hard_stop, 'enabled', c.enabled,
           'spent_today', round(coalesce(d.spent, 0), 2),
           'calls_today', coalesce(d.calls, 0),
           'spent_month', round(coalesce(m.spent, 0), 2),
           'pct_daily', CASE WHEN c.daily_cap_zar > 0 THEN round(coalesce(d.spent,0) / c.daily_cap_zar * 100)
                             WHEN c.daily_call_cap > 0 THEN round(coalesce(d.calls,0)::numeric / c.daily_call_cap * 100)
                             ELSE 0 END)
         ORDER BY c.label)
    INTO v_spend
    FROM public.spend_caps c
    LEFT JOIN LATERAL (
      SELECT sum(cost_zar) AS spent, count(*) AS calls FROM public.spend_ledger
       WHERE provider = c.provider
         AND occurred_at >= date_trunc('day', now() AT TIME ZONE 'Africa/Johannesburg') AT TIME ZONE 'Africa/Johannesburg'
    ) d ON true
    LEFT JOIN LATERAL (
      SELECT sum(cost_zar) AS spent FROM public.spend_ledger
       WHERE provider = c.provider
         AND occurred_at >= date_trunc('month', now() AT TIME ZONE 'Africa/Johannesburg') AT TIME ZONE 'Africa/Johannesburg'
    ) m ON true;

  SELECT jsonb_build_object(
           'last_24h', (SELECT count(*) FROM public.security_events WHERE created_at > now() - interval '24 hours'),
           'high_24h', (SELECT count(*) FROM public.security_events
                         WHERE created_at > now() - interval '24 hours' AND severity IN ('high','critical')),
           'recent', coalesce((SELECT jsonb_agg(jsonb_build_object(
                        'kind', kind, 'severity', severity, 'actor', actor,
                        'detail', detail, 'at', created_at) ORDER BY created_at DESC)
                      FROM (SELECT * FROM public.security_events ORDER BY created_at DESC LIMIT 40) s), '[]'::jsonb))
    INTO v_security;

  RETURN jsonb_build_object('generated_at', now(), 'engines', coalesce(v_engines,'[]'::jsonb),
                            'spend', coalesce(v_spend,'[]'::jsonb), 'security', v_security);
END $fn$;

REVOKE ALL ON FUNCTION public.engine_room_snapshot() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.engine_room_snapshot() TO authenticated, service_role;


-- Every 3 hours. Chosen against the tightest thing being watched: axiz-sync
-- has a 45-minute silence budget, so a 3-hour watch catches a stall within
-- four missed runs. Hourly would catch it sooner and cost four times the AI
-- calls for a business whose whole AI budget is R40 a day -- and the storefront
-- keeps serving from cached prices meanwhile, so this is a stale-data problem,
-- not an outage.
-- Auth matches the other scheduled functions: the shared secret out of the
-- vault, not a service-role bearer inlined into a cron command. A cron
-- definition is readable by anyone who can read cron.job; a key pasted in there
-- is a key on display.
SELECT cron.schedule(
  'engine-room-watch', '25 */3 * * *',
  $cron$
    SELECT net.http_post(
      url := 'https://xwiqubcilptxzvdigsmp.supabase.co/functions/v1/engine-room-analyst',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-internal-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'internal_cron_secret')
      ),
      body := '{"trigger":"cron"}'::jsonb);
  $cron$)
WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'engine-room-watch');
