-- Data retention: keep operational history bounded, and be able to say how.
--
-- WHY A TABLE RATHER THAN CONSTANTS IN A FUNCTION
-- -----------------------------------------------
-- "How long do you keep personal data, and where is that written down?" is
-- the first question in a POPIA assessment and the first question a buyer's
-- lawyer asks. A number buried in a PL/pgSQL body is an answer nobody can find
-- without a developer, so the policy lives in a table an operator can read,
-- with the reasoning attached to each row.
--
-- WHAT IS NOT SWEPT, DELIBERATELY
-- -------------------------------
-- `compliance_access_log` is the POPIA/PAIA audit trail -- it records who
-- reached personal data and when. Sweeping it aggressively would destroy the
-- evidence that the other controls were working, which is the opposite of
-- compliance. It gets three years, which is a retention decision rather than a
-- cleanup decision, and it is the one table here where the risk runs towards
-- deleting too much rather than keeping too much.
--
-- `orders`, `profiles` and anything financial are absent on purpose. Deleting
-- a customer's order history is a business decision with tax consequences
-- (SARS requires five years), not a housekeeping job, and it must never happen
-- because a cron ran.

CREATE TABLE IF NOT EXISTS public.data_retention_policy (
  table_name      text PRIMARY KEY,
  timestamp_column text NOT NULL DEFAULT 'created_at',
  retention_days  integer NOT NULL CHECK (retention_days >= 7),
  rationale       text NOT NULL,
  enabled         boolean NOT NULL DEFAULT true,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.data_retention_policy ENABLE ROW LEVEL SECURITY;

-- Readable by admins so it can be shown in the admin UI and in diligence;
-- writable by nobody through the API. Changing a retention period is a
-- deliberate act that should leave a migration behind, not something a
-- compromised admin session can do to erase its own tracks.
DROP POLICY IF EXISTS "Admins can read retention policy" ON public.data_retention_policy;
CREATE POLICY "Admins can read retention policy"
  ON public.data_retention_policy FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

INSERT INTO public.data_retention_policy (table_name, timestamp_column, retention_days, rationale) VALUES
  ('sync_logs', 'created_at', 90,
   'Integration run history. Ninety days covers every debugging question anyone has actually asked; the table is already the largest on the instance and grows every fifteen minutes with the Axiz sync.'),
  ('automation_events', 'created_at', 180,
   'Automation outcomes and alert-delivery failures. Six months spans a full seasonal cycle of the cron schedule.'),
  ('security_events', 'created_at', 365,
   'Security refusals and guardrail trips. A year, because the question these answer -- "has anyone been probing us, and since when" -- is one you ask long after the fact.'),
  ('ai_usage_log', 'created_at', 180,
   'Per-call AI usage. Cost reconciliation happens monthly; six months allows a full dispute cycle with a provider.'),
  -- occurred_at, not created_at. The first version of this file said
  -- created_at, which does not exist on this table -- and because the sweep
  -- skips policies it cannot resolve, the row would have sat there looking
  -- like a policy while deleting nothing, forever. That is the failure mode a
  -- retention policy must never have: the table grows, and the document says
  -- it does not. Hence the _inert_policies reporting below.
  ('spend_ledger', 'occurred_at', 400,
   'Per-provider spend. Kept over a year so the previous year is still comparable when a cap is reviewed. Never trimmed below the current month, which spend_guard reads to enforce the caps.'),
  ('compliance_access_log', 'created_at', 1095,
   'POPIA/PAIA access audit trail. Three years. This is a retention decision, not cleanup -- it is the evidence that the other controls worked.')
ON CONFLICT (table_name) DO NOTHING;

-- Bounded, policy-driven delete.
--
-- Batched with a hard per-table ceiling so a first run against a table that has
-- gone unswept for a year cannot hold locks for minutes or blow out WAL. The
-- remainder is simply collected on tomorrow's run; there is no deadline here
-- that justifies a long transaction on a live storefront's database.
CREATE OR REPLACE FUNCTION public.retention_sweep(p_max_rows_per_table integer DEFAULT 20000)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
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
$fn$;

REVOKE ALL ON FUNCTION public.retention_sweep(integer) FROM PUBLIC, anon, authenticated;

-- Rides the existing nightly guardrail sweep rather than adding a job. One
-- more entry in cron.job is one more thing that can be silently disabled
-- without anybody noticing which of the thirteen it was.
SELECT cron.schedule(
  'guardrail-sweep',
  '40 4 * * *',
  $cron$ SELECT public.rl_sweep(); SELECT public.threat_sweep(); SELECT public.retention_sweep(); $cron$
);
