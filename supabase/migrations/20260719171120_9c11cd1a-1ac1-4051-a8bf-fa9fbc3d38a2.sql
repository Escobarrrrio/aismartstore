-- Composite partial index to speed up storefront filters
CREATE INDEX IF NOT EXISTS idx_products_active_audience
  ON public.products (audience)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_products_active_audience_ai_price
  ON public.products (audience, is_ai_product, price)
  WHERE is_active = true;

-- Refresh planner stats after today's bulk updates
ANALYZE public.products;