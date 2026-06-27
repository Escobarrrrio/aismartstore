-- =====================================================================
-- FIX: cost/margin protection regression
--
-- The previous migration tried to hide cost_price/selling_price/
-- margin_percentage/axiz_product_id via column-level REVOKE on the
-- products table. That broke the live site: Postgres rejects a bare
-- `SELECT *` entirely if the querying role lacks privilege on ANY
-- column in the table, and the app's product-loading code uses
-- `.select("*")` everywhere. Column-level grants and `SELECT *` don't
-- mix safely.
--
-- Correct fix: move the sensitive columns into their own table with
-- its own RLS, rather than trying to partially lock down columns on
-- a table the storefront legitimately needs to SELECT * from.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.product_costs (
  product_id UUID NOT NULL PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
  cost_price NUMERIC DEFAULT 0,
  selling_price NUMERIC DEFAULT 0,
  margin_percentage NUMERIC DEFAULT 0,
  axiz_product_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.product_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage product costs" ON public.product_costs
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

COMMENT ON TABLE public.product_costs IS '@graphql({"totally_inaccessible": true})';

-- Migrate any existing data (there are 0 rows with cost data at the time
-- of writing, but this is safe to run regardless).
INSERT INTO public.product_costs (product_id, cost_price, selling_price, margin_percentage, axiz_product_id)
SELECT id, cost_price, selling_price, margin_percentage, axiz_product_id
FROM public.products
WHERE cost_price IS NOT NULL OR selling_price IS NOT NULL OR margin_percentage IS NOT NULL OR axiz_product_id IS NOT NULL
ON CONFLICT (product_id) DO NOTHING;

-- Restore full, unrestricted SELECT on products (already done live as an
-- emergency fix; included here so the migration file matches reality).
GRANT SELECT ON public.products TO anon, authenticated;

-- last_synced_at is not sensitive (no pricing/cost implication) and the
-- admin UI already displays it directly from the products table, so it
-- stays put rather than moving into product_costs.
COMMENT ON COLUMN public.products.last_synced_at IS NULL;

-- Drop the now-redundant sensitive columns from products and their
-- now-irrelevant column-level revokes/GraphQL comments.
ALTER TABLE public.products
  DROP COLUMN IF EXISTS cost_price,
  DROP COLUMN IF EXISTS selling_price,
  DROP COLUMN IF EXISTS margin_percentage,
  DROP COLUMN IF EXISTS axiz_product_id;

-- Replace the admin RPC to read from the new table instead.
CREATE OR REPLACE FUNCTION public.get_product_admin_view()
RETURNS TABLE (
  id uuid, cost_price numeric, selling_price numeric,
  margin_percentage numeric, axiz_product_id text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin role required';
  END IF;
  RETURN QUERY
    SELECT pc.product_id, pc.cost_price, pc.selling_price, pc.margin_percentage, pc.axiz_product_id
    FROM public.product_costs pc;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_product_admin_view() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_product_admin_view() TO authenticated;
