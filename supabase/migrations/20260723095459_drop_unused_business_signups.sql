-- business_signups was a fully-built but never-shipped account-signup flow:
-- the only form that inserted into it (BusinessSignupForm.tsx) was never
-- mounted on any route, and the table has 0 rows in production. The live
-- business/government path is Procurement.tsx -> quote_requests (already
-- has its own admin viewer, QuotesModule). Removing the orphaned table and
-- its supporting trigger/function rather than leaving them behind unused.

DROP TRIGGER IF EXISTS business_signup_guard ON public.business_signups;
DROP TRIGGER IF EXISTS business_signups_updated_at ON public.business_signups;
DROP FUNCTION IF EXISTS public.business_signup_rate_limit();
DROP TABLE IF EXISTS public.business_signups;
