
CREATE TABLE IF NOT EXISTS public.business_signups (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  legal_entity_name TEXT NOT NULL,
  trading_name TEXT,
  registration_number TEXT NOT NULL,
  vat_number TEXT,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('business','institution','government','ngo')),
  sector TEXT,
  website TEXT,
  work_email TEXT NOT NULL,
  work_email_domain TEXT NOT NULL,
  contact_full_name TEXT NOT NULL,
  contact_position TEXT,
  contact_phone TEXT,
  address_line TEXT,
  city TEXT,
  province TEXT,
  postal_code TEXT,
  country TEXT DEFAULT 'ZA',
  expected_monthly_spend NUMERIC,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','approved','rejected')),
  reviewer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  ip_address TEXT,
  user_agent TEXT,
  honeypot_flag BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT INSERT ON public.business_signups TO anon;
GRANT INSERT ON public.business_signups TO authenticated;
GRANT SELECT, UPDATE, DELETE ON public.business_signups TO authenticated;
GRANT ALL ON public.business_signups TO service_role;

ALTER TABLE public.business_signups ENABLE ROW LEVEL SECURITY;

-- Anyone can insert (form submission), the guarding is via rate-limit trigger + honeypot.
CREATE POLICY "Anyone can submit a business signup"
  ON public.business_signups FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Admins can read business signups"
  ON public.business_signups FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update business signups"
  ON public.business_signups FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete business signups"
  ON public.business_signups FOR DELETE
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS business_signups_status_idx ON public.business_signups(status);
CREATE INDEX IF NOT EXISTS business_signups_created_idx ON public.business_signups(created_at DESC);
CREATE INDEX IF NOT EXISTS business_signups_work_email_idx ON public.business_signups(lower(work_email));

CREATE OR REPLACE FUNCTION public.business_signup_rate_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recent_count INT;
BEGIN
  NEW.work_email_domain := lower(split_part(NEW.work_email, '@', 2));

  IF NEW.work_email_domain IN (
    'gmail.com','yahoo.com','hotmail.com','outlook.com','icloud.com',
    'live.com','msn.com','aol.com','protonmail.com','proton.me','me.com','ymail.com'
  ) THEN
    RAISE EXCEPTION 'A business or institution email address is required (not a free webmail domain).';
  END IF;

  IF NEW.honeypot_flag = true THEN
    RAISE EXCEPTION 'Submission rejected.';
  END IF;

  SELECT count(*) INTO recent_count
    FROM public.business_signups
    WHERE (lower(work_email) = lower(NEW.work_email)
           OR (ip_address IS NOT NULL AND ip_address = NEW.ip_address))
      AND created_at > now() - interval '60 seconds';

  IF recent_count > 0 THEN
    RAISE EXCEPTION 'Too many submissions. Please wait a minute before trying again.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS business_signup_guard ON public.business_signups;
CREATE TRIGGER business_signup_guard
  BEFORE INSERT ON public.business_signups
  FOR EACH ROW EXECUTE FUNCTION public.business_signup_rate_limit();

DROP TRIGGER IF EXISTS business_signups_updated_at ON public.business_signups;
CREATE TRIGGER business_signups_updated_at
  BEFORE UPDATE ON public.business_signups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
