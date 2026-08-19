-- 1. Enterprise ontology rules -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.b2b_ontology_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_type text NOT NULL CHECK (rule_type IN ('category','brand','keyword')),
  pattern text NOT NULL,
  note text,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_type, pattern)
);

GRANT SELECT ON public.b2b_ontology_rules TO anon, authenticated;
GRANT ALL ON public.b2b_ontology_rules TO service_role;
ALTER TABLE public.b2b_ontology_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read ontology rules"
  ON public.b2b_ontology_rules FOR SELECT USING (true);
CREATE POLICY "Admins manage ontology rules"
  ON public.b2b_ontology_rules FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.b2b_ontology_rules (rule_type, pattern, note) VALUES
  ('category','servers & data centre','Rack/datacentre infrastructure'),
  ('category','support & warranty','Care packs and service contracts are B2B procurement'),
  ('category','software & licensing','Volume/seat licensing'),
  ('keyword','aruba','Enterprise networking + licensing'),
  ('keyword','licen','license/licence/licensing'),
  ('keyword','subscription','Seat subscriptions'),
  ('keyword','care pack','HPE/Dell service contracts'),
  ('keyword','foundation care',NULL),
  ('keyword','warranty',NULL),
  ('keyword','support service',NULL),
  ('keyword','installation service',NULL),
  ('keyword','rack',NULL),
  ('keyword','rackmount',NULL),
  ('keyword','1u ',NULL),
  ('keyword','2u ',NULL),
  ('keyword','proliant',NULL),
  ('keyword','poweredge',NULL),
  ('keyword','sfp',NULL),
  ('keyword','qsfp',NULL),
  ('keyword','poe switch',NULL),
  ('keyword','managed switch',NULL),
  ('keyword','access point',NULL),
  ('keyword','controller appliance',NULL),
  ('keyword','firewall',NULL),
  ('keyword','datacenter',NULL),
  ('keyword','data centre',NULL),
  ('keyword','enterprise',NULL),
  ('keyword','windows server',NULL),
  ('keyword','vmware',NULL),
  ('keyword','hypervisor',NULL),
  ('keyword','san storage',NULL),
  ('keyword','nas enclosure',NULL),
  ('keyword','redundant power supply',NULL),
  ('keyword','kvm switch',NULL),
  ('brand','hpe','Enterprise-only brand'),
  ('brand','aruba',NULL),
  ('brand','cisco',NULL),
  ('brand','fortinet',NULL),
  ('brand','juniper',NULL),
  ('brand','veeam',NULL),
  ('brand','vmware',NULL),
  ('brand','netapp',NULL),
  ('brand','supermicro',NULL)
ON CONFLICT (rule_type, pattern) DO NOTHING;

-- 2. Classifier ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.classify_product_audience(
  p_name text, p_category text, p_brand text, p_price numeric,
  p_price_cap numeric DEFAULT 15000
) RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public','pg_temp'
AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.b2b_ontology_rules r
      WHERE r.enabled
        AND (
          (r.rule_type = 'category' AND lower(coalesce(p_category,'')) = r.pattern)
          OR (r.rule_type = 'brand' AND lower(coalesce(p_brand,'')) = r.pattern)
          OR (r.rule_type = 'keyword' AND (
                lower(coalesce(p_name,'')) LIKE '%' || r.pattern || '%'
             OR lower(coalesce(p_category,'')) LIKE '%' || r.pattern || '%'
          ))
        )
    ) THEN 'business'
    WHEN coalesce(p_price, 0) > p_price_cap THEN 'business'
    ELSE 'residential'
  END;
$$;

REVOKE EXECUTE ON FUNCTION public.classify_product_audience(text,text,text,numeric,numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.classify_product_audience(text,text,text,numeric,numeric) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.products_set_audience()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public','pg_temp'
AS $$
BEGIN
  NEW.audience := public.classify_product_audience(NEW.name, NEW.category, NEW.brand, NEW.price);
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.products_set_audience() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_products_set_audience ON public.products;
CREATE TRIGGER trg_products_set_audience
  BEFORE INSERT OR UPDATE OF name, category, brand, price ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.products_set_audience();

-- 3. Complement rules ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.category_complements (
  source_category text NOT NULL,
  complement_category text NOT NULL,
  weight numeric NOT NULL DEFAULT 1,
  PRIMARY KEY (source_category, complement_category)
);

GRANT SELECT ON public.category_complements TO anon, authenticated;
GRANT ALL ON public.category_complements TO service_role;
ALTER TABLE public.category_complements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read complements"
  ON public.category_complements FOR SELECT USING (true);
CREATE POLICY "Admins manage complements"
  ON public.category_complements FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.category_complements (source_category, complement_category, weight) VALUES
  ('Laptops','Peripherals',3),
  ('Laptops','Monitors & Displays',3),
  ('Laptops','Storage',2),
  ('Laptops','Accessories (General)',2),
  ('Laptops','Cables & Connectivity',1),
  ('Desktops & Workstations','Monitors & Displays',3),
  ('Desktops & Workstations','Peripherals',3),
  ('Desktops & Workstations','GPUs & AI Accelerators',2),
  ('Desktops & Workstations','Memory',2),
  ('Desktops & Workstations','Storage',2),
  ('Monitors & Displays','Cables & Connectivity',3),
  ('Monitors & Displays','Peripherals',2),
  ('Monitors & Displays','Accessories (General)',1),
  ('Peripherals','Accessories (General)',2),
  ('Peripherals','Monitors & Displays',2),
  ('Peripherals','Cables & Connectivity',1),
  ('GPUs & AI Accelerators','Memory',3),
  ('GPUs & AI Accelerators','Storage',2),
  ('GPUs & AI Accelerators','Desktops & Workstations',1),
  ('Storage','Cables & Connectivity',2),
  ('Storage','Accessories (General)',1),
  ('Memory','Storage',2),
  ('Smart Home','Networking',2),
  ('Smart Home','Accessories (General)',1),
  ('Wearables','Accessories (General)',2),
  ('Networking','Cables & Connectivity',3),
  ('Cables & Connectivity','Accessories (General)',1),
  ('Accessories (General)','Peripherals',1)
ON CONFLICT DO NOTHING;

-- 4. Co-purchase signal --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_copurchases (
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  related_product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  score numeric NOT NULL DEFAULT 0,
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, related_product_id)
);

CREATE INDEX IF NOT EXISTS idx_copurchase_product ON public.product_copurchases (product_id, score DESC);

GRANT SELECT ON public.product_copurchases TO anon, authenticated;
GRANT ALL ON public.product_copurchases TO service_role;
ALTER TABLE public.product_copurchases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read copurchases"
  ON public.product_copurchases FOR SELECT USING (true);
CREATE POLICY "Admins manage copurchases"
  ON public.product_copurchases FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.refresh_product_copurchases()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
DECLARE v_rows integer;
BEGIN
  DELETE FROM public.product_copurchases;
  INSERT INTO public.product_copurchases (product_id, related_product_id, score)
  SELECT a.product_id, b.product_id, count(*)::numeric
  FROM public.order_items a
  JOIN public.order_items b
    ON a.order_id = b.order_id AND a.product_id <> b.product_id
  JOIN public.orders o ON o.id = a.order_id
  WHERE o.payment_status = 'paid'
  GROUP BY a.product_id, b.product_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.refresh_product_copurchases() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_product_copurchases() TO service_role;

-- 5. Recommendation reader -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_recommended_products(
  p_product_id uuid,
  p_audience text DEFAULT NULL,
  p_limit integer DEFAULT 8
)
RETURNS TABLE(
  id uuid, name text, price numeric, category text, brand text,
  images text[], in_stock boolean, is_ai_product boolean,
  audience text, reason text, score numeric
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public','pg_temp'
AS $$
DECLARE
  v_src public.products%ROWTYPE;
  v_aud text;
  v_limit integer := least(greatest(coalesce(p_limit, 8), 1), 24);
BEGIN
  SELECT * INTO v_src FROM public.products WHERE public.products.id = p_product_id;
  IF NOT FOUND THEN RETURN; END IF;

  v_aud := lower(coalesce(p_audience, v_src.audience, 'residential'));
  IF v_aud NOT IN ('residential','business','all') THEN v_aud := 'residential'; END IF;

  RETURN QUERY
  WITH cf AS (
    SELECT p.id, 100 + c.score AS s, 'Frequently bought together'::text AS why
    FROM public.product_copurchases c
    JOIN public.products p ON p.id = c.related_product_id
    WHERE c.product_id = p_product_id
      AND p.is_active = true
      AND (v_aud = 'all' OR p.audience = v_aud)
  ),
  rules AS (
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
  merged AS (
    SELECT * FROM cf
    UNION ALL
    SELECT * FROM rules
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
$$;

REVOKE EXECUTE ON FUNCTION public.get_recommended_products(uuid,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_recommended_products(uuid,text,integer) TO anon, authenticated, service_role;

-- 6. Kill the un-segmented search overload ------------------------------------
DROP FUNCTION IF EXISTS public.search_products(text,text,text,boolean,boolean,numeric,numeric,text,integer,integer);