-- Admins had SELECT on all profiles (see "Admins can view all profiles") but
-- no UPDATE policy, so there was no way for an admin to actually action an
-- account-type change request -- the only path was a raw DB edit outside the
-- app. Mirrors the existing has_role()-gated admin UPDATE policy already
-- used on support_tickets.
CREATE POLICY "Admins can update all profiles" ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
