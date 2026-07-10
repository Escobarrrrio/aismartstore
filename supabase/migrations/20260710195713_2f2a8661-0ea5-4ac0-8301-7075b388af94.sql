
UPDATE public.products p
   SET is_active = false, updated_at = now()
  FROM public._broken_image_products b
 WHERE p.id = b.id
   AND p.is_active = true;

DROP TABLE public._broken_image_products;
