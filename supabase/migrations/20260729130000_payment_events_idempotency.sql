-- Payment event audit log + idempotency for PayFast ITN handling.
--
-- PayFast retries an ITN until it receives a 200, and will legitimately send
-- the same notification more than once. The previous handler had no guard: every
-- delivery of a COMPLETE notification re-ran the order update AND re-invoked
-- notify-order, so a single payment could email the customer and the owner
-- repeatedly. This makes "exactly once" a property of the database rather than
-- something the function has to remember.
--
-- Idempotency key: PayFast's pf_payment_id, which is unique per transaction.
-- The partial unique index means only ONE row per (provider, payment, status)
-- may ever reach outcome='processed'. Two concurrent deliveries race for that
-- row; the loser is told it is a duplicate. Non-processed rows (rejections,
-- errors, duplicates) are unconstrained, so the audit trail keeps every attempt.

CREATE TABLE IF NOT EXISTS public.payment_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider            text NOT NULL DEFAULT 'payfast',
  provider_payment_id text,
  order_id            uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  event_type          text NOT NULL,
  payment_status      text,
  amount_gross        numeric,
  amount_fee          numeric,
  amount_net          numeric,
  -- processed | duplicate_ignored | rejected_ip | rejected_signature
  -- | rejected_validation | amount_mismatch | error | unknown_order
  outcome             text NOT NULL,
  sandbox             boolean NOT NULL DEFAULT false,
  source_ip           text,
  signature_valid     boolean,
  notified            boolean NOT NULL DEFAULT false,
  raw_payload         jsonb,
  error_message       text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.payment_events IS
  'Append-only audit of every payment-provider callback: what arrived, whether it verified, and what was done about it. One processed row per transaction+status is enforced by idx_payment_events_idempotency.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_events_idempotency
  ON public.payment_events (provider, provider_payment_id, payment_status)
  WHERE outcome = 'processed' AND provider_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_events_order    ON public.payment_events (order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_events_outcome  ON public.payment_events (outcome, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_events_created  ON public.payment_events (created_at DESC);

-- Payment data is admin-only. No anon/authenticated policy is defined, so RLS
-- denies everything; the webhook writes with the service role, which bypasses
-- RLS, and admins read through the admin API.
ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view payment events" ON public.payment_events;
CREATE POLICY "Admins can view payment events"
  ON public.payment_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Records an event and reports whether THIS caller is the one that gets to do
-- the side effects. Returns is_first = false when an identical processed event
-- already exists, in which case the caller must not touch the order or send
-- any notification.
CREATE OR REPLACE FUNCTION public.record_payment_event(
  p_provider            text,
  p_provider_payment_id text,
  p_order_id            uuid,
  p_event_type          text,
  p_payment_status      text,
  p_outcome             text,
  p_amount_gross        numeric DEFAULT NULL,
  p_amount_fee          numeric DEFAULT NULL,
  p_amount_net          numeric DEFAULT NULL,
  p_sandbox             boolean DEFAULT false,
  p_source_ip           text    DEFAULT NULL,
  p_signature_valid     boolean DEFAULT NULL,
  p_raw                 jsonb   DEFAULT NULL,
  p_error               text    DEFAULT NULL
)
RETURNS TABLE(event_id uuid, is_first boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;

REVOKE ALL ON FUNCTION public.record_payment_event(text, text, uuid, text, text, text, numeric, numeric, numeric, boolean, text, boolean, jsonb, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_payment_event(text, text, uuid, text, text, text, numeric, numeric, numeric, boolean, text, boolean, jsonb, text) TO service_role;

COMMENT ON FUNCTION public.record_payment_event IS
  'Appends a payment_events row and returns is_first=false when an identical processed event already exists. Callers must skip all side effects (order updates, notifications) when is_first is false.';
