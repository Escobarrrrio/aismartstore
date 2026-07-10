
CREATE TABLE public.profile_admin_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.profile_admin_notes TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profile_admin_notes TO authenticated;

ALTER TABLE public.profile_admin_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage profile admin notes"
  ON public.profile_admin_notes
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_profile_admin_notes_updated_at
  BEFORE UPDATE ON public.profile_admin_notes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Migrate any existing notes
INSERT INTO public.profile_admin_notes (user_id, notes)
SELECT user_id, admin_notes
FROM public.profiles
WHERE admin_notes IS NOT NULL AND admin_notes <> ''
ON CONFLICT (user_id) DO NOTHING;

ALTER TABLE public.profiles DROP COLUMN admin_notes;
