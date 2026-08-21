-- Zero-downtime rotation of the internal cron secret.
CREATE TABLE IF NOT EXISTS public.internal_cron_secret_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  secret_sha256 text NOT NULL,
  fingerprint text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','retiring','retired')),
  activated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  rotated_by uuid,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.internal_cron_secret_versions TO authenticated;
GRANT ALL ON public.internal_cron_secret_versions TO service_role;
ALTER TABLE public.internal_cron_secret_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read cron secret versions" ON public.internal_cron_secret_versions;
CREATE POLICY "admins read cron secret versions"
ON public.internal_cron_secret_versions
FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE UNIQUE INDEX IF NOT EXISTS internal_cron_secret_one_active
  ON public.internal_cron_secret_versions (status) WHERE status = 'active';

-- Validates a presented secret against the currently active version, or a
-- retiring version whose grace window has not expired yet. That overlap is
-- what makes rotation zero-downtime: an in-flight cron job holding the old
-- value still authenticates until the window closes.
CREATE OR REPLACE FUNCTION public.verify_internal_cron_secret(p_secret text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.internal_cron_secret_versions v
    WHERE p_secret IS NOT NULL
      AND length(p_secret) > 0
      AND v.secret_sha256 = encode(sha256(convert_to(p_secret, 'utf8')), 'hex')
      AND (
        v.status = 'active'
        OR (v.status = 'retiring' AND v.expires_at IS NOT NULL AND v.expires_at > now())
      )
  );
$$;

REVOKE ALL ON FUNCTION public.verify_internal_cron_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_internal_cron_secret(text) TO service_role;

-- Performs the rotation itself: mints a new random secret, writes it into the
-- vault entry that every pg_cron job already reads at call time (so no job
-- command has to be rewritten), and keeps the previous value valid for the
-- grace window.
CREATE OR REPLACE FUNCTION public.rotate_internal_cron_secret(
  p_grace_minutes integer DEFAULT 60,
  p_rotated_by uuid DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS TABLE (new_secret text, fingerprint text, grace_until timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_secret text;
  v_fp text;
  v_grace timestamptz;
  v_vault_id uuid;
BEGIN
  IF p_grace_minutes < 5 OR p_grace_minutes > 1440 THEN
    RAISE EXCEPTION 'grace window must be between 5 and 1440 minutes';
  END IF;

  v_secret := encode(extensions.gen_random_bytes(32), 'hex');
  v_fp := left(encode(sha256(convert_to(v_secret, 'utf8')), 'hex'), 12);
  v_grace := now() + make_interval(mins => p_grace_minutes);

  -- Previous active version enters its grace window.
  UPDATE public.internal_cron_secret_versions
     SET status = 'retiring', expires_at = v_grace
   WHERE status = 'active';

  INSERT INTO public.internal_cron_secret_versions (secret_sha256, fingerprint, status, rotated_by, note)
  VALUES (encode(sha256(convert_to(v_secret, 'utf8')), 'hex'), v_fp, 'active', p_rotated_by, p_note);

  SELECT id INTO v_vault_id FROM vault.secrets WHERE name = 'internal_cron_secret';
  IF v_vault_id IS NULL THEN
    PERFORM vault.create_secret(v_secret, 'internal_cron_secret', 'Shared secret for scheduled edge function calls');
  ELSE
    PERFORM vault.update_secret(v_vault_id, v_secret, 'internal_cron_secret', 'Shared secret for scheduled edge function calls');
  END IF;

  RETURN QUERY SELECT v_secret, v_fp, v_grace;
END;
$$;

REVOKE ALL ON FUNCTION public.rotate_internal_cron_secret(integer, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rotate_internal_cron_secret(integer, uuid, text) TO service_role;

-- Closes an open grace window immediately (used by the admin "finish now" action).
CREATE OR REPLACE FUNCTION public.finalize_internal_cron_secret_rotation()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH done AS (
    UPDATE public.internal_cron_secret_versions
       SET status = 'retired', expires_at = now()
     WHERE status = 'retiring'
     RETURNING 1
  ) SELECT count(*)::int FROM done;
$$;

REVOKE ALL ON FUNCTION public.finalize_internal_cron_secret_rotation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_internal_cron_secret_rotation() TO service_role;

-- Seed the current live secret so the new verifier accepts it before the first rotation.
INSERT INTO public.internal_cron_secret_versions (secret_sha256, fingerprint, status, note)
SELECT encode(sha256(convert_to(s.decrypted_secret, 'utf8')), 'hex'),
       left(encode(sha256(convert_to(s.decrypted_secret, 'utf8')), 'hex'), 12),
       'active',
       'Seeded from existing vault value'
FROM vault.decrypted_secrets s
WHERE s.name = 'internal_cron_secret'
  AND NOT EXISTS (SELECT 1 FROM public.internal_cron_secret_versions WHERE status = 'active');

-- Expire stale grace windows automatically.
SELECT cron.schedule(
  'finalize-cron-secret-rotation',
  '*/10 * * * *',
  $cron$ UPDATE public.internal_cron_secret_versions SET status = 'retired' WHERE status = 'retiring' AND expires_at IS NOT NULL AND expires_at <= now(); $cron$
);