
-- 1) Blocklist table
CREATE TABLE IF NOT EXISTS public.image_blocklist (
  url TEXT PRIMARY KEY,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.image_blocklist TO authenticated;
GRANT ALL ON public.image_blocklist TO service_role;
ALTER TABLE public.image_blocklist ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage image blocklist" ON public.image_blocklist
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 2) Seed known generic placeholders (brand-logo images reused across many SKUs)
INSERT INTO public.image_blocklist(url, reason) VALUES
  ('https://cdn.cs.1worldsync.com/f0/71/f0713e18-c808-4447-b974-27309581192d.jpg', 'generic 1worldsync placeholder'),
  ('https://cdn.cs.1worldsync.com/20/f8/20f8e722-6485-46c1-a893-e9f1494cba5b.jpg', 'generic 1worldsync placeholder'),
  ('https://staxdstoragecdn.blob.core.windows.net/axd-live/vmware.jpg', 'brand logo placeholder'),
  ('https://staxdstoragecdn.blob.core.windows.net/axd-live/ibm.jpg', 'brand logo placeholder'),
  ('https://staxdstoragecdn.blob.core.windows.net/axd-live/adobe.jpg', 'brand logo placeholder'),
  ('https://staxdstoragecdn.blob.core.windows.net/axd-live/forcepoint.jpg', 'brand logo placeholder'),
  ('https://staxdstoragecdn.blob.core.windows.net/axd-live/audio codes.jpg', 'brand logo placeholder'),
  ('https://staxdstoragecdn.blob.core.windows.net/axd-live/mcafee.jpg', 'brand logo placeholder'),
  ('https://staxdstoragecdn.blob.core.windows.net/axd-live/veeam.jpg', 'brand logo placeholder'),
  ('https://staxdstoragecdn.blob.core.windows.net/axd-live/nozomi networks.jpg', 'brand logo placeholder'),
  ('https://staxdstoragecdn.blob.core.windows.net/axd-live/nettrace.jpg', 'brand logo placeholder')
ON CONFLICT (url) DO NOTHING;

-- 3) Trigger: before insert/update, hide products whose primary image is blocked
CREATE OR REPLACE FUNCTION public.enforce_image_blocklist()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.images IS NULL OR array_length(NEW.images,1) IS NULL THEN
    NEW.is_active := false;
  ELSIF EXISTS (SELECT 1 FROM public.image_blocklist b WHERE b.url = NEW.images[1]) THEN
    NEW.is_active := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS products_enforce_blocklist ON public.products;
CREATE TRIGGER products_enforce_blocklist
  BEFORE INSERT OR UPDATE OF images ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.enforce_image_blocklist();

-- 4) Fast index for lookups by primary image
CREATE INDEX IF NOT EXISTS products_first_image_idx
  ON public.products ((images[1])) WHERE is_active = true;

-- 5) Chunked cleanup procedure to deactivate historical rows without holding long locks
CREATE OR REPLACE PROCEDURE public.deactivate_blocked_products()
LANGUAGE plpgsql AS $$
DECLARE
  affected INT;
BEGIN
  LOOP
    UPDATE public.products
    SET is_active = false
    WHERE ctid IN (
      SELECT p.ctid FROM public.products p
      JOIN public.image_blocklist b ON b.url = p.images[1]
      WHERE p.is_active
      LIMIT 2000
    );
    GET DIAGNOSTICS affected = ROW_COUNT;
    COMMIT;
    EXIT WHEN affected = 0;
  END LOOP;
END;
$$;
