-- Fix a checkout-breaking type mismatch that only exists in source control.
--
-- `log_order_changes()` fires BEFORE every order INSERT and writes the opening
-- row of the order audit trail. Its first statement is:
--
--   COALESCE(NEW.status, NEW.order_status, 'pending')
--
-- `orders.status` is text and `orders.order_status` is an enum, and COALESCE
-- requires a common type:
--
--   ERROR: COALESCE types text and order_status cannot be matched
--
-- Because the trigger is on INSERT, that error aborts the insert. Every
-- checkout fails, at the last step, after the customer has paid.
--
-- The live database does not have this bug -- it carries `NEW.order_status::text`.
-- The cast was applied straight to the database and never written back into a
-- migration, so the defect exists only in the version of this store that can
-- be rebuilt from this repository. It was invisible precisely because the one
-- database anybody ever exercised was already correct.
--
-- Found by replaying the migrations into an empty PostgreSQL 16 cluster and
-- inserting a single order.

CREATE OR REPLACE FUNCTION public.log_order_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
$function$;
