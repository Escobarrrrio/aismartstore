-- =====================================================================
-- Consolidated migration: manual schema changes applied 2026-07-09/10
-- via direct SQL during Axiz integration and search build.
-- All statements are idempotent -- safe on live DB (already applied)
-- and on a fresh rebuild.
-- NOTE: image_blocklist table/trigger and deactivate_blocked_products_batch
-- are NOT here -- they were created by Lovable agent migrations already
-- in supabase/migrations/.
-- =====================================================================

-- 1. Extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. products: sku column + full unique constraint (partial index replaced)
ALTER TABLE products ADD COLUMN IF NOT EXISTS sku text;
DROP INDEX IF EXISTS products_sku_unique_idx;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_sku_key'
  ) THEN
    ALTER TABLE products ADD CONSTRAINT products_sku_key UNIQUE (sku);
  END IF;
END $$;

-- 3. products: AI-product flag + partial index for the AI Pulse section
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_ai_product boolean DEFAULT false;
CREATE INDEX IF NOT EXISTS products_is_ai_product_idx
  ON products (is_ai_product) WHERE is_ai_product = true;

-- 4. products: widen price (enterprise gear + bad feed rows overflowed 10,2)
ALTER TABLE products ALTER COLUMN price TYPE numeric(14,2);

-- 5. products: full-text search vector (generated) + indexes
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'products' AND column_name = 'search_vector'
  ) THEN
    ALTER TABLE products ADD COLUMN search_vector tsvector
      GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(brand, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(category, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(description, '')), 'C')
      ) STORED;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS products_search_vector_idx
  ON products USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS products_name_trgm_idx
  ON products USING GIN (name gin_trgm_ops);

-- 6. Search RPC used by Products.tsx and HeaderSearch.tsx
CREATE OR REPLACE FUNCTION search_products(
  search_query text DEFAULT '',
  filter_category text DEFAULT NULL,
  filter_brand text DEFAULT NULL,
  filter_ai_only boolean DEFAULT false,
  filter_in_stock_only boolean DEFAULT false,
  min_price numeric DEFAULT NULL,
  max_price numeric DEFAULT NULL,
  sort_by text DEFAULT 'relevance',
  page_number int DEFAULT 0,
  page_size int DEFAULT 24
)
RETURNS TABLE (
  id uuid, sku text, slug text, name text, description text, price numeric,
  category text, brand text, stock_quantity int, in_stock boolean,
  images text[], is_ai_product boolean, total_count bigint
) AS $$
DECLARE
  ts_query tsquery;
BEGIN
  IF trim(search_query) = '' THEN
    ts_query := NULL;
  ELSE
    ts_query := plainto_tsquery('english', search_query);
  END IF;

  RETURN QUERY
  SELECT p.id, p.sku, p.slug, p.name, p.description, p.price,
         p.category, p.brand, p.stock_quantity, p.in_stock,
         p.images, p.is_ai_product,
         count(*) OVER() AS total_count
  FROM products p
  WHERE p.is_active = true
    AND (
      trim(search_query) = ''
      OR p.search_vector @@ ts_query
      OR p.name % search_query
    )
    AND (filter_category IS NULL OR p.category = filter_category)
    AND (filter_brand IS NULL OR p.brand = filter_brand)
    AND (filter_ai_only = false OR p.is_ai_product = true)
    AND (filter_in_stock_only = false OR p.in_stock = true)
    AND (min_price IS NULL OR p.price >= min_price)
    AND (max_price IS NULL OR p.price <= max_price)
  ORDER BY
    CASE WHEN sort_by = 'relevance' AND trim(search_query) != '' THEN
      ts_rank(p.search_vector, ts_query) + similarity(p.name, search_query)
    END DESC NULLS LAST,
    CASE WHEN sort_by = 'price_asc' THEN p.price END ASC NULLS LAST,
    CASE WHEN sort_by = 'price_desc' THEN p.price END DESC NULLS LAST,
    CASE WHEN sort_by = 'newest' THEN p.last_synced_at END DESC NULLS LAST,
    p.name ASC
  LIMIT page_size
  OFFSET page_number * page_size;
END;
$$ LANGUAGE plpgsql STABLE;

ALTER FUNCTION search_products(text,text,text,boolean,boolean,numeric,numeric,text,integer,integer)
  SET search_path = public, pg_temp;

-- Drop the orphaned 7-parameter overload if a rebuild recreates it
DROP FUNCTION IF EXISTS search_products(text,text,text,boolean,text,integer,integer);

-- 7. Storage RLS: product-images bucket locked to admins only
DROP POLICY IF EXISTS "Authenticated users can delete product images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update product images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload product images" ON storage.objects;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins can upload product images') THEN
    CREATE POLICY "Admins can upload product images" ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'product-images' AND has_role(auth.uid(), 'admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins can update product images') THEN
    CREATE POLICY "Admins can update product images" ON storage.objects
      FOR UPDATE TO authenticated
      USING (bucket_id = 'product-images' AND has_role(auth.uid(), 'admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins can delete product images') THEN
    CREATE POLICY "Admins can delete product images" ON storage.objects
      FOR DELETE TO authenticated
      USING (bucket_id = 'product-images' AND has_role(auth.uid(), 'admin'));
  END IF;
END $$;

-- 8. Store settings used by axiz-sync (idempotent seeds; values may have
--    been changed since in the live DB -- ON CONFLICT leaves live values alone)
INSERT INTO store_settings (key, value) VALUES
  ('axiz_markets', '14'),
  ('axiz_brand_filter', ''),
  ('axiz_sync_cursor', '0:0')
ON CONFLICT (key) DO NOTHING;
