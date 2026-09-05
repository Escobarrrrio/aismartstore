-- Applies the already-committed Aug 20 fix that never reached production.
-- Live DB still runs the original "Anyone can view products USING (true)"
-- policy, exposing the full B2B/enterprise catalogue and any draft/inactive
-- product to unauthenticated visitors. This replaces it with the two
-- policies already in supabase/migrations/20260820073157_....sql.
--
-- Safe to run more than once (DROP ... IF EXISTS, then two CREATE POLICY
-- statements with names that don't already exist live).

DROP POLICY IF EXISTS "Anyone can view products" ON public.products;

CREATE POLICY "Public sees residential catalogue only"
ON public.products FOR SELECT TO anon
USING (is_active = true AND audience = 'residential');

CREATE POLICY "Signed-in users see the full catalogue"
ON public.products FOR SELECT TO authenticated
USING (true);
