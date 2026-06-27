-- =====================================================================
-- SECURITY LOCKDOWN
-- Fixes every issue surfaced by the Supabase security advisor:
-- 8 critical RLS holes, cost/margin exposure, SECURITY DEFINER function
-- exposure, and GraphQL schema exposure of internal tables.
--
-- Root cause: several "Authenticated users can manage X" policies were
-- written as USING (true) instead of checking for the admin role, so
-- ANY signed-up customer (not just staff) could read other customers'
-- orders/profiles, edit products and prices, or touch store settings.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. PRODUCTS: any authenticated user could create/update/delete
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can manage products" ON public.products;
CREATE POLICY "Admins can manage products" ON public.products
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
-- "Anyone can view products" (USING true) is left intact below in step 9,
-- where it is narrowed at the column level instead of the row level.

-- ---------------------------------------------------------------------
-- 2. CATEGORIES: any authenticated user could create/update/delete
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can manage categories" ON public.categories;
CREATE POLICY "Admins can manage categories" ON public.categories
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ---------------------------------------------------------------------
-- 3. STORE SETTINGS: any authenticated user could read/write (Yoco keys etc.)
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can manage settings" ON public.store_settings;
CREATE POLICY "Admins can manage settings" ON public.store_settings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ---------------------------------------------------------------------
-- 4. ORDERS: any authenticated user could read ALL orders (names, emails,
--    phones, addresses) and update ANY order, not just their own
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can view orders" ON public.orders;
CREATE POLICY "Users can view own orders, admins view all" ON public.orders
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Authenticated users can update orders" ON public.orders;
CREATE POLICY "Admins can update orders" ON public.orders
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ---------------------------------------------------------------------
-- 5. ORDER ITEMS: any authenticated user could read every line item of
--    every order placed by anyone
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can view order items" ON public.order_items;
CREATE POLICY "Users can view own order items, admins view all" ON public.order_items
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (SELECT 1 FROM public.orders WHERE orders.id = order_items.order_id AND orders.user_id = auth.uid())
  );

-- ---------------------------------------------------------------------
-- 6. PROFILES: policy was literally named "Admins can view all profiles"
--    but its condition was USING (true) -- it admin-gated nothing
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
CREATE POLICY "Admins can view all profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
-- "Users can view their own profile" (auth.uid() = user_id) is left intact.

-- ---------------------------------------------------------------------
-- 7. AI CONVERSATIONS: any anonymous visitor could update ANY chat
--    session, including ones that were not theirs
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can update conversations" ON public.ai_conversations;
-- The ai-chat edge function writes/updates conversations using the
-- service_role key, which bypasses RLS entirely, so the client never
-- needs direct UPDATE access. Admins retain visibility via the existing
-- "Admins can view all conversations" SELECT policy.

COMMENT ON TABLE public.ai_conversations IS 'Chat history. Writes happen only via the ai-chat edge function (service role); the client has no direct write policy by design.';

-- =====================================================================
-- 8. COST PRICE / MARGIN: "Anyone can view products" (USING true) exposes
--    every column including cost_price, selling_price, margin_percentage
--    and axiz_product_id to anyone with the public anon key. RLS is
--    row-level only, so this needs a column-level grant, not a policy.
-- =====================================================================
REVOKE SELECT ON public.products FROM anon, authenticated;
GRANT SELECT (
  id, name, description, price, category, images, in_stock,
  created_at, updated_at, slug, specifications, brand, brand_id,
  stock_quantity, stock_status, is_active, category_id
) ON public.products TO anon, authenticated;

-- Admins (and only admins) get the sensitive columns back through a
-- dedicated function rather than a raw table grant, since Postgres
-- column privileges apply to the whole "authenticated" role and cannot
-- distinguish "admin app-user" from "customer app-user" on their own.
CREATE OR REPLACE FUNCTION public.get_product_admin_view()
RETURNS TABLE (
  id uuid, name text, cost_price numeric, selling_price numeric,
  margin_percentage numeric, axiz_product_id text, last_synced_at timestamptz
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
    SELECT p.id, p.name, p.cost_price, p.selling_price, p.margin_percentage,
           p.axiz_product_id, p.last_synced_at
    FROM public.products p;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_product_admin_view() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_product_admin_view() TO authenticated;

-- =====================================================================
-- 9. SECURITY DEFINER FUNCTIONS: granted EXECUTE to PUBLIC by default
-- =====================================================================
-- handle_new_user() only needs to run as the auth.users INSERT trigger.
-- It should never be callable directly via RPC by anon or authenticated.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- has_role() is used inside RLS policies evaluated as the authenticated
-- role, so that role genuinely needs EXECUTE. anon never calls it.
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;

-- =====================================================================
-- 10. GRAPHQL SCHEMA EXPOSURE: pg_graphql exposes every table/column by
--     default, including internal/operational tables and cost fields,
--     regardless of whether the app even uses GraphQL.
-- =====================================================================
COMMENT ON TABLE public.store_settings IS '@graphql({"totally_inaccessible": true})';
COMMENT ON TABLE public.sync_logs IS '@graphql({"totally_inaccessible": true})';
COMMENT ON TABLE public.automation_events IS '@graphql({"totally_inaccessible": true})';
COMMENT ON TABLE public.notifications IS '@graphql({"totally_inaccessible": true})';
COMMENT ON TABLE public.ai_conversations IS '@graphql({"totally_inaccessible": true})';
COMMENT ON COLUMN public.products.cost_price IS '@graphql({"totally_inaccessible": true})';
COMMENT ON COLUMN public.products.selling_price IS '@graphql({"totally_inaccessible": true})';
COMMENT ON COLUMN public.products.margin_percentage IS '@graphql({"totally_inaccessible": true})';
COMMENT ON COLUMN public.products.axiz_product_id IS '@graphql({"totally_inaccessible": true})';

-- =====================================================================
-- NOTE ON "Public Bucket Allows Listing" (product-images storage bucket):
-- This bucket is intentionally public -- product photos need to be
-- viewable by anonymous shoppers with no login. The advisory flags that
-- public buckets also allow directory-style listing of file names, which
-- is accepted here since the bucket holds only product photos (no PII,
-- no business-sensitive data). Documented as an accepted risk rather
-- than silently left unaddressed.
-- =====================================================================

-- =====================================================================
-- NOTE ON "RLS Policy Always True": the remaining USING (true) policies
-- are intentional, not bugs:
--   - "Anyone can view products" / "Anyone can view categories" /
--     "Anyone can view brands": public storefront reads (now column-
--     scoped for products, see step 8).
--   - "Anyone can create orders" / "Anyone can create order items":
--     INSERT-only, required for guest checkout.
--   - "Anyone can create conversations": INSERT-only, required for
--     anonymous chat sessions.
--   - "Product images are publicly accessible": intentional public read.
-- =====================================================================
