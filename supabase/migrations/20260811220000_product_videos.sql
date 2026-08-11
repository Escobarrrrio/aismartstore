-- Per-product video uploads: a `videos` column mirroring the existing
-- `images text[]`, and a dedicated storage bucket with the same
-- admin-only write policy already proven on product-images.
--
-- A separate bucket rather than reusing product-images: video files are
-- routinely 10-100x an image's size, and mixing them in one bucket makes
-- "list every image" (used nowhere today, but a reasonable future admin
-- tool) accidentally pull megabytes of video bytes it never needed.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS videos text[] NOT NULL DEFAULT '{}'::text[];

COMMENT ON COLUMN public.products.videos IS
  'Public storage URLs for product demo/unboxing videos. Same pattern as images -- ordered, no dedicated primary flag; the storefront treats index 0 as the lead clip.';

INSERT INTO storage.buckets (id, name, public)
VALUES ('product-videos', 'product-videos', true)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins can upload product videos') THEN
    CREATE POLICY "Admins can upload product videos" ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'product-videos' AND has_role(auth.uid(), 'admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins can update product videos') THEN
    CREATE POLICY "Admins can update product videos" ON storage.objects
      FOR UPDATE TO authenticated
      USING (bucket_id = 'product-videos' AND has_role(auth.uid(), 'admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins can delete product videos') THEN
    CREATE POLICY "Admins can delete product videos" ON storage.objects
      FOR DELETE TO authenticated
      USING (bucket_id = 'product-videos' AND has_role(auth.uid(), 'admin'));
  END IF;
END $$;
