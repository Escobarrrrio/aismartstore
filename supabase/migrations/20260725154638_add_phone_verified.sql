-- Backs mandatory phone verification (Telnyx Verify API, see
-- supabase/functions/send-phone-otp and verify-phone-otp). Defaults to
-- false for new signups going through the OTP step; existing accounts are
-- intentionally left at false too rather than silently reinterpreted as
-- verified, but nothing currently gates access on this column, so no
-- existing user is locked out by this migration alone -- enforcement is
-- limited to the signup completion flow in src/pages/Auth.tsx.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone_verified boolean NOT NULL DEFAULT false;
