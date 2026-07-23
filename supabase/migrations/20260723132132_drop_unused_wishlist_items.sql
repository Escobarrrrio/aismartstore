-- wishlist_items predates all tracked migration history -- it's referenced
-- in the 20260629162705 security-hardening migration's anon-SELECT-revoke
-- list, but no migration ever created it, meaning it was part of the
-- project's original speculative scaffolding. Zero rows, zero application
-- code ever queried it (only appeared in the auto-generated types file).
-- Superseded by the wishlists table (20260723120157_create_wishlists.sql),
-- which is the one actually wired to WishlistContext/ProductCard/
-- ProductDetail/Account. Same pattern as business_signups, addresses, and
-- notification_preferences -- pre-built but never wired to any UI.

DROP TABLE IF EXISTS public.wishlist_items;
