
CREATE POLICY "Admins can read email send log"
  ON public.email_send_log
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

GRANT SELECT ON public.email_send_log TO authenticated;
