-- Persistent wishlist. Previously the heart icon on ProductCard was pure
-- local component state -- it reset on every re-render and was never
-- backed by anything, so "Saved Items" in Account was permanently empty.
-- Authenticated-only by design (no guest/localStorage wishlist): a saved
-- item is a durable customer record worth having tied to a real account,
-- and this matches how a signed-out visitor is already handled elsewhere
-- on the site (e.g. requestReturn/createTicket in Account.tsx).

CREATE TABLE IF NOT EXISTS public.wishlists (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, product_id)
);

ALTER TABLE public.wishlists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own wishlist"
  ON public.wishlists FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins view all wishlists"
  ON public.wishlists FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS wishlists_user_id_idx ON public.wishlists(user_id);
CREATE INDEX IF NOT EXISTS wishlists_product_id_idx ON public.wishlists(product_id);

GRANT SELECT, INSERT, DELETE ON public.wishlists TO authenticated;
GRANT ALL ON public.wishlists TO service_role;
