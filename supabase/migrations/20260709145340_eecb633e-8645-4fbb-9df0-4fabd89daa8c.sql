
-- Order audit log: append-only trail of every status/payment/tracking change on an order.
CREATE TABLE IF NOT EXISTS public.order_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  actor_id uuid,
  actor_email text,
  event_type text NOT NULL,
  from_value text,
  to_value text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.order_audit_log TO authenticated;
GRANT ALL ON public.order_audit_log TO service_role;

ALTER TABLE public.order_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view all audit entries"
  ON public.order_audit_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert audit entries"
  ON public.order_audit_log FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_order_audit_order_id ON public.order_audit_log(order_id, created_at DESC);

-- Trigger: capture status, payment_status, order_status and tracking changes
CREATE OR REPLACE FUNCTION public.log_order_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.order_audit_log(order_id, actor_id, event_type, to_value, metadata)
    VALUES (NEW.id, v_actor, 'order_created', COALESCE(NEW.status, NEW.order_status, 'pending'),
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

DROP TRIGGER IF EXISTS trg_log_order_changes ON public.orders;
CREATE TRIGGER trg_log_order_changes
  AFTER INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.log_order_changes();
