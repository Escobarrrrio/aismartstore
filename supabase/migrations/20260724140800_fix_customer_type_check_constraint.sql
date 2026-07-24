-- profiles.customer_type had a CHECK constraint allowing only
-- ('individual', 'business') -- but every single piece of application code
-- (Auth.tsx's AccountType, the account-type gate UI, useCustomerType,
-- AudienceGuard, admin CustomersModule/OrdersModule/DashboardModule) uses
-- 'residential', never 'individual'. The column's own DEFAULT was
-- 'individual', so this was silent: signUp() itself succeeds (the
-- handle_new_user trigger doesn't touch customer_type), but the
-- follow-up UPDATE that sets the real chosen type (plus phone and
-- id_number, in the same statement) fails the CHECK constraint and rolls
-- back atomically -- leaving the customer signed in with an account stuck
-- at the DB default, phone and id_number silently never saved, and no
-- error surfaced anywhere the user would understand as "your account type
-- didn't save." Same failure mode for Google sign-in landing on an
-- unconfirmed account type.
--
-- Found via a real user report (residential signup "didn't want to
-- register", then Google sign-in "did nothing") -- confirmed against
-- live data: exactly one profile stuck at customer_type='individual' with
-- phone and id_number both null, matching this failure mode precisely.
--
-- Order matters here: the old constraint has to come off before existing
-- 'individual' rows can be updated to 'residential', and the new
-- constraint can only go on after that data is clean (checked immediately
-- against all existing rows on ADD).

ALTER TABLE public.profiles DROP CONSTRAINT profiles_customer_type_check;

UPDATE public.profiles SET customer_type = 'residential' WHERE customer_type = 'individual';

ALTER TABLE public.profiles ADD CONSTRAINT profiles_customer_type_check
  CHECK (customer_type = ANY (ARRAY['residential'::text, 'business'::text]));

ALTER TABLE public.profiles ALTER COLUMN customer_type SET DEFAULT 'residential';
