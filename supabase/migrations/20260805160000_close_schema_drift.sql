-- Close the drift between the repo's migration history and the live database.
--
-- WHY THIS EXISTS
--
-- The migration history in this repo could not rebuild this store. Replaying
-- all 85 migrations into an empty PostgreSQL 16 cluster produced 43 of the
-- live database's 51 tables. Eight tables had no CREATE TABLE statement
-- anywhere in the repo -- they were created directly against the live database
-- and never written down. Three more tables had columns that exist in
-- production and nowhere in the history, including `products.audience`, which
-- the entire home-page merchandising engine partitions on.
--
-- Measured drift (repo replay vs. live database, column-signature hash per
-- table -- 40 of 51 tables were already byte-identical):
--
--   missing entirely : addresses, ai_pulse_items, exchange_rates,
--                      newsletter_campaigns, newsletter_story_sends,
--                      newsletter_subscribers, notification_preferences,
--                      quote_requests
--   missing columns  : orders.province
--                      products.audience
--                      profiles.* (14 columns: address/company/VAT/consent)
--
-- That gap is why the database was only restorable from the hosting provider's
-- own copy of it. Everything below is transcribed from the live database's
-- catalogues -- defaults, constraints, indexes, RLS policies and triggers --
-- so the schema is reproducible from source control alone.
--
-- Written to be a no-op against the live database (every statement is
-- IF NOT EXISTS / OR REPLACE / guarded), and complete against an empty one.

-- ---------------------------------------------------------------- addresses
CREATE TABLE IF NOT EXISTS public.addresses (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label          text NOT NULL DEFAULT 'Home',
  recipient_name text,
  line1          text NOT NULL,
  line2          text,
  city           text NOT NULL,
  province       text,
  postal_code    text,
  country        text NOT NULL DEFAULT 'South Africa',
  phone          text,
  is_default     boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.addresses ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------- ai_pulse_items
CREATE TABLE IF NOT EXISTS public.ai_pulse_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text NOT NULL,
  url          text NOT NULL UNIQUE,
  summary      text,
  source       text NOT NULL,
  category     text NOT NULL,
  image_url    text,
  published_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_pulse_items ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_ai_pulse_published ON public.ai_pulse_items (published_at DESC);

-- ----------------------------------------------------------- exchange_rates
CREATE TABLE IF NOT EXISTS public.exchange_rates (
  currency_code text PRIMARY KEY,
  rate_to_zar   numeric NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.exchange_rates ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------- newsletter_campaigns
CREATE TABLE IF NOT EXISTS public.newsletter_campaigns (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject         text NOT NULL,
  preview_text    text,
  body_html       text NOT NULL,
  category_filter text,
  status          text NOT NULL DEFAULT 'draft',
  recipient_count integer,
  sent_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.newsletter_campaigns ENABLE ROW LEVEL SECURITY;

-- --------------------------------------------------- newsletter_subscribers
CREATE TABLE IF NOT EXISTS public.newsletter_subscribers (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 text NOT NULL UNIQUE,
  name                  text,
  user_id               uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  source                text NOT NULL DEFAULT 'footer',
  interested_categories text[] DEFAULT '{}'::text[],
  unsubscribe_token     uuid NOT NULL DEFAULT gen_random_uuid(),
  subscribed_at         timestamptz NOT NULL DEFAULT now(),
  unsubscribed_at       timestamptz
);
ALTER TABLE public.newsletter_subscribers ENABLE ROW LEVEL SECURITY;
-- Case-insensitive uniqueness on top of the plain UNIQUE(email): a subscriber
-- who signs up as Fernando@... and fernando@... is one person, and the digest
-- must not reach them twice.
CREATE UNIQUE INDEX IF NOT EXISTS newsletter_subscribers_email_lower_key
  ON public.newsletter_subscribers (lower(email));

-- --------------------------------------------------- newsletter_story_sends
-- One row per story ever sent. The PRIMARY KEY on item_id is what stops the
-- same story going out in two consecutive digests.
CREATE TABLE IF NOT EXISTS public.newsletter_story_sends (
  item_id     uuid PRIMARY KEY REFERENCES public.ai_pulse_items(id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES public.newsletter_campaigns(id) ON DELETE SET NULL,
  sent_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.newsletter_story_sends ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------- notification_preferences
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  order_updates      boolean NOT NULL DEFAULT true,
  delivery_alerts    boolean NOT NULL DEFAULT true,
  promotional_emails boolean NOT NULL DEFAULT false,
  sms_notifications  boolean NOT NULL DEFAULT false,
  updated_at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------- quote_requests
CREATE TABLE IF NOT EXISTS public.quote_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_name text NOT NULL,
  contact_name      text NOT NULL,
  email             text NOT NULL,
  phone             text,
  entity_type       text NOT NULL DEFAULT 'private',
  requirements      text NOT NULL,
  estimated_value   numeric,
  status            text NOT NULL DEFAULT 'new',
  admin_notes       text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.quote_requests ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------ drifted columns
ALTER TABLE public.orders   ADD COLUMN IF NOT EXISTS province text;

-- The column the home page partitions on. Defaulting to 'business' is
-- deliberate: an unclassified product should not surface to shoppers by
-- accident, it should stay out of the residential pool until something
-- classifies it.
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'business';

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS address_line1      text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS address_line2      text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url         text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS city               text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS company_name       text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS country            text NOT NULL DEFAULT 'South Africa';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS customer_type      text NOT NULL DEFAULT 'residential';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS id_number          text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_login_at      timestamptz;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS marketing_opt_in   boolean NOT NULL DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS postal_code        text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS preferred_language text NOT NULL DEFAULT 'en';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS province           text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS vat_number         text;

-- `phone_verified` only ever existed in the replayed history; the live database
-- settled on `is_phone_verified`. Drop the duplicate so a rebuilt database does
-- not carry a second, always-false verification flag that nothing reads.
ALTER TABLE public.profiles DROP COLUMN IF EXISTS phone_verified;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_audience_check') THEN
    ALTER TABLE public.products ADD CONSTRAINT products_audience_check
      CHECK (audience = ANY (ARRAY['residential'::text, 'business'::text]));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_customer_type_check') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_customer_type_check
      CHECK (customer_type = ANY (ARRAY['residential'::text, 'business'::text]));
  END IF;
END $$;

-- Partial unique indexes: a person may leave these blank, but two people must
-- not claim the same ID number, phone, or business VAT number.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_id_number_unique_idx
  ON public.profiles (id_number) WHERE id_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS profiles_phone_unique_idx
  ON public.profiles (phone) WHERE phone IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS profiles_vat_number_unique_idx
  ON public.profiles (vat_number) WHERE vat_number IS NOT NULL AND customer_type = 'business';

CREATE INDEX IF NOT EXISTS products_audience_idx ON public.products (audience);
CREATE INDEX IF NOT EXISTS idx_products_active_audience
  ON public.products (audience) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_products_active_audience_ai_price
  ON public.products (audience, is_ai_product, price) WHERE is_active = true;

-- ---------------------------------------------------------------- policies
-- DROP-then-CREATE because CREATE POLICY has no IF NOT EXISTS, and this file
-- has to be safe to run against a database where these already exist.
DROP POLICY IF EXISTS "Users manage own addresses" ON public.addresses;
CREATE POLICY "Users manage own addresses" ON public.addresses
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Admins view all addresses" ON public.addresses;
CREATE POLICY "Admins view all addresses" ON public.addresses
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Anyone can view AI pulse items" ON public.ai_pulse_items;
CREATE POLICY "Anyone can view AI pulse items" ON public.ai_pulse_items
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Anyone can view exchange rates" ON public.exchange_rates;
CREATE POLICY "Anyone can view exchange rates" ON public.exchange_rates
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins can manage campaigns" ON public.newsletter_campaigns;
CREATE POLICY "Admins can manage campaigns" ON public.newsletter_campaigns
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins can manage subscribers" ON public.newsletter_subscribers;
CREATE POLICY "Admins can manage subscribers" ON public.newsletter_subscribers
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- Anonymous sign-up is allowed, but the row is validated on the way in: a
-- real-looking address, sane length, and no attaching someone else's user_id.
DROP POLICY IF EXISTS "Anyone can subscribe" ON public.newsletter_subscribers;
CREATE POLICY "Anyone can subscribe" ON public.newsletter_subscribers
  FOR INSERT WITH CHECK (
    email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
    AND length(email) BETWEEN 5 AND 254
    AND (user_id IS NULL OR user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users manage own notification prefs" ON public.notification_preferences;
CREATE POLICY "Users manage own notification prefs" ON public.notification_preferences
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can manage quote requests" ON public.quote_requests;
CREATE POLICY "Admins can manage quote requests" ON public.quote_requests
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Anyone can submit a validated quote request" ON public.quote_requests;
CREATE POLICY "Anyone can submit a validated quote request" ON public.quote_requests
  FOR INSERT TO anon, authenticated WITH CHECK (
    length(coalesce(organisation_name, '')) BETWEEN 2 AND 200
    AND length(coalesce(contact_name, '')) BETWEEN 2 AND 120
    AND email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    AND length(email) BETWEEN 5 AND 320
    AND length(requirements) BETWEEN 10 AND 5000
    AND entity_type = ANY (ARRAY['private','public','ngo','education','government','sme','enterprise'])
    AND (estimated_value IS NULL OR (estimated_value >= 0 AND estimated_value < 1000000000))
    AND (phone IS NULL OR length(phone) BETWEEN 5 AND 40)
  );

-- `newsletter_story_sends` intentionally carries RLS with no policy: it is
-- written only by SECURITY DEFINER digest functions and the service role, and
-- nothing client-side has any business reading who was sent what.

-- ---------------------------------------------------------------- triggers
DO $$
BEGIN
  IF to_regprocedure('public.trigger_welcome_email()') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'newsletter_welcome_email') THEN
    CREATE TRIGGER newsletter_welcome_email AFTER INSERT ON public.newsletter_subscribers
      FOR EACH ROW EXECUTE FUNCTION public.trigger_welcome_email();
  END IF;
  IF to_regprocedure('public.tg_threat_newsletter()') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'threat_gate_newsletter') THEN
    CREATE TRIGGER threat_gate_newsletter BEFORE INSERT ON public.newsletter_subscribers
      FOR EACH ROW EXECUTE FUNCTION public.tg_threat_newsletter();
  END IF;
  IF to_regprocedure('public.tg_threat_quote()') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'threat_gate_quote') THEN
    CREATE TRIGGER threat_gate_quote BEFORE INSERT ON public.quote_requests
      FOR EACH ROW EXECUTE FUNCTION public.tg_threat_quote();
  END IF;
  IF to_regprocedure('public.log_quote_request_submitted()') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_log_quote_request_submitted') THEN
    CREATE TRIGGER trg_log_quote_request_submitted AFTER INSERT ON public.quote_requests
      FOR EACH ROW EXECUTE FUNCTION public.log_quote_request_submitted();
  END IF;
  IF to_regprocedure('public.update_updated_at_column()') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_profiles_updated_at') THEN
    CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;

GRANT SELECT ON public.ai_pulse_items, public.exchange_rates TO anon, authenticated;
