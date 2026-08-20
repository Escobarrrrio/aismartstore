-- 1. Server-side B2B exclusion for signed-out visitors -----------------
DROP POLICY IF EXISTS "Anyone can view products" ON public.products;

CREATE POLICY "Public sees residential catalogue only"
ON public.products FOR SELECT TO anon
USING (is_active = true AND audience = 'residential');

CREATE POLICY "Signed-in users see the full catalogue"
ON public.products FOR SELECT TO authenticated
USING (true);

-- Belt and braces: the search RPCs clamp the requested audience for
-- unauthenticated callers (including the service-role public feed) so a
-- hand-crafted filter_audience='business' can never widen the scope.
CREATE OR REPLACE FUNCTION public.search_products(search_query text DEFAULT ''::text, filter_category text DEFAULT NULL::text, filter_brand text DEFAULT NULL::text, filter_ai_only boolean DEFAULT false, filter_in_stock_only boolean DEFAULT false, min_price numeric DEFAULT NULL::numeric, max_price numeric DEFAULT NULL::numeric, sort_by text DEFAULT 'relevance'::text, page_number integer DEFAULT 0, page_size integer DEFAULT 24, filter_audience text DEFAULT 'residential'::text)
 RETURNS TABLE(id uuid, sku text, slug text, name text, description text, price numeric, category text, brand text, stock_quantity integer, in_stock boolean, images text[], is_ai_product boolean, audience text, total_count bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  has_search  boolean := btrim(coalesce(search_query, '')) <> '';
  ts_query    tsquery;
  v_sort      text := coalesce(sort_by, 'relevance');
  v_audience  text := CASE WHEN auth.uid() IS NULL
                           THEN 'residential'
                           ELSE lower(coalesce(filter_audience, 'residential')) END;
BEGIN
  IF has_search THEN
    ts_query := plainto_tsquery('english', search_query);
  END IF;

  RETURN QUERY
    SELECT p.id, p.sku, p.slug, p.name, p.description, p.price,
           p.category, p.brand, p.stock_quantity, p.in_stock,
           p.images, p.is_ai_product, p.audience,
           count(*) OVER() AS total_count
    FROM public.products p
    WHERE p.is_active = true
      AND (v_audience = 'all' OR p.audience = v_audience)
      AND (
        NOT has_search
        OR p.search_vector @@ ts_query
        OR p.name % search_query
      )
      AND (filter_category IS NULL OR lower(p.category) = lower(filter_category))
      AND (filter_brand    IS NULL OR lower(p.brand)    = lower(filter_brand))
      AND (NOT filter_ai_only       OR p.is_ai_product = true)
      AND (NOT filter_in_stock_only OR p.in_stock = true)
      AND (min_price IS NULL OR p.price >= min_price)
      AND (max_price IS NULL OR p.price <= max_price)
    ORDER BY
      CASE WHEN v_sort = 'relevance' AND has_search
           THEN ts_rank(p.search_vector, ts_query) + similarity(p.name, search_query)
      END DESC NULLS LAST,
      CASE WHEN v_sort = 'price_asc'  THEN p.price END ASC  NULLS LAST,
      CASE WHEN v_sort = 'price_desc' THEN p.price END DESC NULLS LAST,
      CASE WHEN v_sort = 'newest'     THEN p.last_synced_at END DESC NULLS LAST,
      p.name ASC
    LIMIT page_size OFFSET page_number * page_size;
END;
$function$;

CREATE OR REPLACE FUNCTION public.search_product_facets(search_query text DEFAULT ''::text, filter_category text DEFAULT NULL::text, filter_brand text DEFAULT NULL::text, filter_ai_only boolean DEFAULT false, filter_in_stock_only boolean DEFAULT false, min_price numeric DEFAULT NULL::numeric, max_price numeric DEFAULT NULL::numeric, filter_audience text DEFAULT 'residential'::text)
 RETURNS TABLE(facet_type text, facet_value text, product_count bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  has_search boolean := btrim(coalesce(search_query, '')) <> '';
  ts_query   tsquery;
  v_audience text := CASE WHEN auth.uid() IS NULL
                          THEN 'residential'
                          ELSE lower(coalesce(filter_audience, 'residential')) END;
BEGIN
  IF has_search THEN
    ts_query := plainto_tsquery('english', search_query);
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT p.category, p.brand, p.is_ai_product, p.in_stock, p.price
    FROM public.products p
    WHERE p.is_active = true
      AND (v_audience = 'all' OR p.audience = v_audience)
      AND (
        NOT has_search
        OR p.search_vector @@ ts_query
        OR p.name % search_query
      )
  ),
  priced AS (
    SELECT * FROM base b
    WHERE (min_price IS NULL OR b.price >= min_price)
      AND (max_price IS NULL OR b.price <= max_price)
  ),
  cat_scope AS (
    SELECT * FROM priced b
    WHERE (filter_brand IS NULL OR lower(b.brand) = lower(filter_brand))
      AND (NOT filter_ai_only       OR b.is_ai_product = true)
      AND (NOT filter_in_stock_only OR b.in_stock = true)
  ),
  brand_scope AS (
    SELECT * FROM priced b
    WHERE (filter_category IS NULL OR lower(b.category) = lower(filter_category))
      AND (NOT filter_ai_only       OR b.is_ai_product = true)
      AND (NOT filter_in_stock_only OR b.in_stock = true)
  ),
  toggle_scope AS (
    SELECT * FROM priced b
    WHERE (filter_category IS NULL OR lower(b.category) = lower(filter_category))
      AND (filter_brand    IS NULL OR lower(b.brand)    = lower(filter_brand))
  ),
  price_scope AS (
    SELECT * FROM base b
    WHERE (filter_category IS NULL OR lower(b.category) = lower(filter_category))
      AND (filter_brand    IS NULL OR lower(b.brand)    = lower(filter_brand))
      AND (NOT filter_ai_only       OR b.is_ai_product = true)
      AND (NOT filter_in_stock_only OR b.in_stock = true)
  )
  SELECT 'category'::text,
         mode() WITHIN GROUP (ORDER BY c.category)::text,
         count(*)::bigint
    FROM cat_scope c
   WHERE c.category IS NOT NULL AND btrim(c.category) <> ''
   GROUP BY lower(c.category)
  UNION ALL
  SELECT 'brand'::text,
         mode() WITHIN GROUP (ORDER BY b.brand)::text,
         count(*)::bigint
    FROM brand_scope b
   WHERE b.brand IS NOT NULL AND btrim(b.brand) <> ''
   GROUP BY lower(b.brand)
  UNION ALL
  SELECT 'toggle'::text, 'ai_ready'::text, count(*)::bigint
    FROM toggle_scope t
   WHERE t.is_ai_product = true
     AND (NOT filter_in_stock_only OR t.in_stock = true)
  UNION ALL
  SELECT 'toggle'::text, 'in_stock'::text, count(*)::bigint
    FROM toggle_scope t
   WHERE t.in_stock = true
     AND (NOT filter_ai_only OR t.is_ai_product = true)
  UNION ALL
  SELECT 'meta'::text, 'price_min'::text, floor(coalesce(min(p.price), 0))::bigint FROM price_scope p
  UNION ALL
  SELECT 'meta'::text, 'price_max'::text, ceil(coalesce(max(p.price), 0))::bigint  FROM price_scope p
  ORDER BY 1 ASC, 3 DESC, 2 ASC;
END;
$function$;

-- 2. Editable per-status customer email templates ----------------------
CREATE TABLE IF NOT EXISTS public.order_email_templates (
  status text PRIMARY KEY,
  label text NOT NULL,
  subject text NOT NULL,
  body_html text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_email_templates TO authenticated;
GRANT ALL ON public.order_email_templates TO service_role;
ALTER TABLE public.order_email_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage order email templates"
ON public.order_email_templates FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- 3. Durable outbound queue with retry state ---------------------------
CREATE TABLE IF NOT EXISTS public.order_email_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  template_status text NOT NULL,
  recipient_email text NOT NULL,
  subject text NOT NULL,
  body_html text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  provider_message_id text,
  idempotency_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_order_email_queue_due
  ON public.order_email_queue (next_attempt_at)
  WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_order_email_queue_order
  ON public.order_email_queue (order_id, created_at DESC);

GRANT SELECT ON public.order_email_queue TO authenticated;
GRANT ALL ON public.order_email_queue TO service_role;
ALTER TABLE public.order_email_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read the order email queue"
ON public.order_email_queue FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE OR REPLACE FUNCTION public.touch_order_email_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
REVOKE EXECUTE ON FUNCTION public.touch_order_email_updated_at() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_order_email_queue_touch ON public.order_email_queue;
CREATE TRIGGER trg_order_email_queue_touch BEFORE UPDATE ON public.order_email_queue
FOR EACH ROW EXECUTE FUNCTION public.touch_order_email_updated_at();

DROP TRIGGER IF EXISTS trg_order_email_templates_touch ON public.order_email_templates;
CREATE TRIGGER trg_order_email_templates_touch BEFORE UPDATE ON public.order_email_templates
FOR EACH ROW EXECUTE FUNCTION public.touch_order_email_updated_at();