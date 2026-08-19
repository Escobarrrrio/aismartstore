CREATE OR REPLACE FUNCTION public.get_recommended_products(p_product_id uuid, p_audience text DEFAULT NULL::text, p_limit integer DEFAULT 8)
 RETURNS TABLE(id uuid, name text, price numeric, category text, brand text, images text[], in_stock boolean, is_ai_product boolean, audience text, reason text, score numeric)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_src public.products%ROWTYPE;
  v_aud text;
  v_limit integer := least(greatest(coalesce(p_limit, 8), 1), 24);
  v_accessory_patterns text[] := ARRAY[
    '%monitor%','%display%','%mice%','%mouse%','%keyboard%','%peripheral%',
    '%accessor%','%storage%','%ssd%','%hard drive%','%dock%','%headset%',
    '%webcam%','%cable%','%adapter%','%printer%','%speaker%','%bag%','%hub%'
  ];
BEGIN
  SELECT * INTO v_src FROM public.products WHERE public.products.id = p_product_id;
  IF NOT FOUND THEN RETURN; END IF;

  v_aud := lower(coalesce(p_audience, v_src.audience, 'residential'));
  IF v_aud NOT IN ('residential','business','all') THEN v_aud := 'residential'; END IF;

  RETURN QUERY
  WITH cf AS (
    -- Tier 1: real co-purchase history.
    SELECT p.id, 100 + c.score AS s, 'Frequently bought together'::text AS why
    FROM public.product_copurchases c
    JOIN public.products p ON p.id = c.related_product_id
    WHERE c.product_id = p_product_id
      AND p.is_active = true
      AND (v_aud = 'all' OR p.audience = v_aud)
  ),
  rules AS (
    -- Tier 2: curated category-complement map.
    SELECT p.id, cc.weight AS s, ('Pairs with ' || v_src.category)::text AS why
    FROM public.category_complements cc
    JOIN public.products p
      ON lower(p.category) = lower(cc.complement_category)
    WHERE lower(cc.source_category) = lower(coalesce(v_src.category,''))
      AND p.is_active = true
      AND p.in_stock = true
      AND p.id <> p_product_id
      AND (v_aud = 'all' OR p.audience = v_aud)
      AND coalesce(array_length(p.images, 1), 0) > 0
      AND (v_src.price IS NULL OR p.price <= greatest(v_src.price * 1.2, 2500))
  ),
  brand_fallback AS (
    -- Tier 3: same-brand accessories/peripherals, for sparse histories.
    SELECT p.id, 12::numeric AS s, ('More from ' || p.brand)::text AS why
    FROM public.products p
    WHERE p.is_active = true
      AND p.in_stock = true
      AND p.id <> p_product_id
      AND (v_aud = 'all' OR p.audience = v_aud)
      AND coalesce(array_length(p.images, 1), 0) > 0
      AND v_src.brand IS NOT NULL
      AND lower(p.brand) = lower(v_src.brand)
      AND lower(coalesce(p.category,'')) <> lower(coalesce(v_src.category,''))
      AND lower(coalesce(p.category,'') || ' ' || p.name) ILIKE ANY (v_accessory_patterns)
      AND (v_src.price IS NULL OR p.price <= greatest(v_src.price, 2500))
    ORDER BY p.price ASC
    LIMIT 24
  ),
  accessory_fallback AS (
    -- Tier 4: any in-audience peripheral/monitor/storage add-on, so the
    -- bundle is never empty just because this SKU has no history yet.
    SELECT p.id, 6::numeric AS s, 'Popular add-on'::text AS why
    FROM public.products p
    WHERE p.is_active = true
      AND p.in_stock = true
      AND p.id <> p_product_id
      AND (v_aud = 'all' OR p.audience = v_aud)
      AND coalesce(array_length(p.images, 1), 0) > 0
      AND lower(coalesce(p.category,'') || ' ' || p.name) ILIKE ANY (v_accessory_patterns)
      AND lower(coalesce(p.category,'')) <> lower(coalesce(v_src.category,''))
      AND (v_src.price IS NULL OR p.price <= greatest(v_src.price, 2500))
    ORDER BY p.price ASC
    LIMIT 24
  ),
  merged AS (
    SELECT * FROM cf
    UNION ALL SELECT * FROM rules
    UNION ALL SELECT * FROM brand_fallback
    UNION ALL SELECT * FROM accessory_fallback
  ),
  best AS (
    SELECT m.id, max(m.s) AS s, min(m.why) AS why
    FROM merged m
    WHERE m.id <> p_product_id
    GROUP BY m.id
  )
  SELECT p.id, p.name, p.price, p.category, p.brand, p.images,
         p.in_stock, p.is_ai_product, p.audience, b.why, b.s
  FROM best b
  JOIN public.products p ON p.id = b.id
  ORDER BY b.s DESC, p.in_stock DESC, p.price ASC
  LIMIT v_limit;
END;
$function$;