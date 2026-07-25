-- Renamed to match the naming used across the rest of the phone-verification
-- spec (send-phone-otp / verify-phone-otp / frontend all updated to match).
ALTER TABLE public.profiles RENAME COLUMN phone_verified TO is_phone_verified;

-- Structured send log for the Telnyx SMS OTP path: every send attempt
-- (success or failure) lands here with Telnyx's raw status code and error
-- body, so a delivery problem shows up in a queryable table instead of only
-- an edge function console log. Also doubles as the source of truth for the
-- 60-second resend cooldown enforced server-side in send-phone-otp.
CREATE TABLE public.sms_send_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  phone text NOT NULL,
  purpose text NOT NULL DEFAULT 'phone_verification',
  status text NOT NULL CHECK (status IN ('sent', 'failed')),
  telnyx_status_code integer,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sms_send_log ENABLE ROW LEVEL SECURITY;

-- Only admins can read it via the client; only the service role (edge
-- functions) ever writes to it, so no INSERT/UPDATE policy is needed.
CREATE POLICY "Admins can view sms send log" ON public.sms_send_log
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_sms_send_log_user_created ON public.sms_send_log(user_id, created_at DESC);
