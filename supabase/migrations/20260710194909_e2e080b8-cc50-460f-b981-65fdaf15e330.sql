
-- 1. Normalize http -> https on all product images
UPDATE public.products
SET images = ARRAY(SELECT replace(unnest, 'http://', 'https://') FROM unnest(images))
WHERE EXISTS (SELECT 1 FROM unnest(images) u WHERE u LIKE 'http://%');

-- 2. Identify shared/generic images (used by >3 products = brand logo, not product photo)
WITH shared AS (
  SELECT images[1] AS img
  FROM public.products
  WHERE is_active = true AND array_length(images,1) >= 1
  GROUP BY images[1]
  HAVING count(*) > 3
)
UPDATE public.products p
SET is_active = false
WHERE p.is_active = true
  AND (
    p.images IS NULL
    OR array_length(p.images,1) IS NULL
    OR p.images[1] IN (SELECT img FROM shared)
  );
