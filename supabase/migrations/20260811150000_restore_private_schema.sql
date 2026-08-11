-- Restores the `private` schema, lost when this project was seeded from a
-- schema dump of the old Lovable-managed database.
--
-- Confirmed live: `SELECT nspname FROM pg_namespace WHERE nspname = 'private'`
-- returned nothing, while four public wrapper functions still call straight
-- into it -- public.engine_room_snapshot(), public.set_newsletter_interests(),
-- public.get_compliance_pack(), public.get_newsletter_subscriber_count().
-- Every one of those has been throwing "schema \"private\" does not exist"
-- since the migration off Lovable Cloud -- which is what surfaced as "Could
-- not read the engine room" in the Admin UI. The dump captured the public
-- wrappers (their bodies literally reference private.*_impl) but never
-- created the schema those calls depend on.
--
-- (public.get_product_admin_view is NOT restored here -- it was independently
-- rewritten at some point after the file history in this repo to read
-- straight from public.products, and no longer touches the private schema.)
--
-- Recreated verbatim from the original migration history (matching git blame
-- on 20260720195606, 20260721105118, 20260730170000, 20260730171555), with
-- two real grant gaps fixed along the way rather than reproduced: both
-- get_newsletter_subscriber_count_impl and get_compliance_pack_impl were
-- missing EXECUTE for `anon`, even though their public wrappers already grant
-- anon and both are called by anonymous visitors (the newsletter subscriber
-- count on the public signup form, the compliance pack unlock on the public
-- Procurement quote form) -- so the original migrations would have thrown
-- "permission denied for function ..._impl" for exactly the callers their own
-- comments say they're for.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated, service_role, anon;

-- 1. Engine Room snapshot -----------------------------------------------------

CREATE OR REPLACE FUNCTION private.engine_room_snapshot_impl()
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

REVOKE ALL ON FUNCTION private.engine_room_snapshot_impl() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.engine_room_snapshot_impl() TO authenticated, service_role;

-- 2. Newsletter interests ------------------------------------------------------

CREATE OR REPLACE FUNCTION private.set_newsletter_interests_impl(
  _subscriber_id uuid, _email text, _categories text[]
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  allowed  text[] := ARRAY['ai', 'networking', 'computing', 'software'];
  cleaned  text[];
  updated  integer;
BEGIN
  IF _subscriber_id IS NULL OR _email IS NULL OR btrim(_email) = '' THEN
    RETURN false;
  END IF;

  SELECT coalesce(array_agg(DISTINCT c), ARRAY[]::text[])
    INTO cleaned
    FROM unnest(coalesce(_categories, ARRAY[]::text[])) AS c
   WHERE c = ANY (allowed);

  UPDATE public.newsletter_subscribers
     SET interested_categories = cleaned
   WHERE id = _subscriber_id
     AND lower(email) = lower(btrim(_email));

  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated > 0;
END;
$$;

REVOKE EXECUTE ON FUNCTION private.set_newsletter_interests_impl(uuid, text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.set_newsletter_interests_impl(uuid, text, text[]) TO anon, authenticated, service_role;

-- 3. Compliance pack ------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.get_compliance_pack_impl(_quote_id uuid, _email text, _actor uuid)
RETURNS SETOF public.compliance_documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_match boolean := false;
BEGIN
  IF _quote_id IS NULL OR _email IS NULL OR btrim(_email) = '' THEN
    INSERT INTO public.compliance_access_log(event_type, quote_request_id, email, actor_id, metadata)
    VALUES ('pack_unlock_denied', _quote_id, _email, _actor,
            jsonb_build_object('reason','missing_input'));
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.quote_requests
    WHERE id = _quote_id AND lower(email) = lower(btrim(_email))
  ) INTO v_match;

  IF NOT v_match THEN
    INSERT INTO public.compliance_access_log(event_type, quote_request_id, email, actor_id, metadata)
    VALUES ('pack_unlock_denied', _quote_id, _email, _actor,
            jsonb_build_object('reason','no_matching_quote'));
    RETURN;
  END IF;

  INSERT INTO public.compliance_access_log(event_type, quote_request_id, email, actor_id, metadata)
  VALUES ('pack_unlock_success', _quote_id, _email, _actor, '{}'::jsonb);

  RETURN QUERY SELECT * FROM public.compliance_documents ORDER BY created_at ASC LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION private.get_compliance_pack_impl(uuid, text, uuid) FROM PUBLIC;
-- `anon` added on top of the original migration's authenticated/service_role
-- grant: the wrapper itself is already granted to anon (Procurement.tsx's quote
-- form is anonymous), so leaving anon off the impl would have meant the same
-- "permission denied" this whole migration exists to fix, just moved down one
-- level rather than removed.
GRANT EXECUTE ON FUNCTION private.get_compliance_pack_impl(uuid, text, uuid) TO anon, authenticated, service_role;

-- 4. Newsletter subscriber count -------------------------------------------------

CREATE OR REPLACE FUNCTION private.get_newsletter_subscriber_count_impl()
RETURNS bigint
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT count(*)::bigint FROM public.newsletter_subscribers;
$$;

REVOKE ALL ON FUNCTION private.get_newsletter_subscriber_count_impl() FROM PUBLIC;
-- Same fix as above: the public wrapper is granted to anon (the subscriber
-- count renders on the public newsletter signup form), so anon needs it here
-- too, not just authenticated/service_role.
GRANT EXECUTE ON FUNCTION private.get_newsletter_subscriber_count_impl() TO anon, authenticated, service_role;
