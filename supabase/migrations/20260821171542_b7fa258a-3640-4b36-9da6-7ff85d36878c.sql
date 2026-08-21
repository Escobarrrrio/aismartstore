-- Realtime for order status timeline
ALTER TABLE public.orders REPLICA IDENTITY FULL;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Admin: requeue a failed / stuck order notification email
CREATE OR REPLACE FUNCTION public.admin_requeue_order_email(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE public.order_email_queue
     SET status = 'queued',
         attempts = 0,
         next_attempt_at = now(),
         last_error = NULL
   WHERE id = p_id;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_requeue_order_email(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_requeue_order_email(uuid) TO authenticated, service_role;

-- Admin: consolidated notification audit (queue + provider send log)
CREATE OR REPLACE FUNCTION public.admin_order_email_audit(
  p_order_id uuid DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS TABLE(
  id uuid,
  order_id uuid,
  order_short text,
  customer_name text,
  template_status text,
  recipient_email text,
  subject text,
  status text,
  attempts integer,
  max_attempts integer,
  next_attempt_at timestamptz,
  last_error text,
  provider_message_id text,
  created_at timestamptz,
  sent_at timestamptz,
  delivery_status text,
  delivery_error text,
  delivery_logged_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    q.id,
    q.order_id,
    upper(substr(q.order_id::text, 1, 8)) AS order_short,
    o.customer_name,
    q.template_status,
    q.recipient_email,
    q.subject,
    q.status,
    q.attempts,
    q.max_attempts,
    q.next_attempt_at,
    q.last_error,
    q.provider_message_id,
    q.created_at,
    q.sent_at,
    l.status AS delivery_status,
    l.error_message AS delivery_error,
    l.created_at AS delivery_logged_at
  FROM public.order_email_queue q
  LEFT JOIN public.orders o ON o.id = q.order_id
  LEFT JOIN LATERAL (
    SELECT s.status, s.error_message, s.created_at
    FROM public.email_send_log s
    WHERE s.recipient_email = q.recipient_email
      AND (s.message_id = q.provider_message_id
           OR s.created_at BETWEEN q.created_at - interval '1 minute' AND coalesce(q.sent_at, q.updated_at) + interval '5 minutes')
    ORDER BY s.created_at DESC
    LIMIT 1
  ) l ON TRUE
  WHERE public.has_role(auth.uid(), 'admin'::app_role)
    AND (p_order_id IS NULL OR q.order_id = p_order_id)
    AND (p_status IS NULL OR q.status = p_status)
  ORDER BY q.created_at DESC
  LIMIT greatest(1, least(coalesce(p_limit, 100), 500));
$$;

REVOKE ALL ON FUNCTION public.admin_order_email_audit(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_order_email_audit(uuid, text, integer) TO authenticated, service_role;