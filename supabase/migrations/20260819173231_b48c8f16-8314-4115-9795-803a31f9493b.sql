DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                 WHERE t.typname = 'order_status' AND e.enumlabel = 'packed') THEN
    ALTER TYPE public.order_status ADD VALUE 'packed' AFTER 'paid';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                 WHERE t.typname = 'order_status' AND e.enumlabel = 'cancelled') THEN
    ALTER TYPE public.order_status ADD VALUE 'cancelled';
  END IF;
END $$;