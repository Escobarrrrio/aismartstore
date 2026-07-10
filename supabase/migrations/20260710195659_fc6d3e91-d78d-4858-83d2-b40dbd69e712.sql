
CREATE TABLE IF NOT EXISTS public._broken_image_products (id uuid PRIMARY KEY);
GRANT ALL ON public._broken_image_products TO service_role;
ALTER TABLE public._broken_image_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin only" ON public._broken_image_products FOR ALL USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
