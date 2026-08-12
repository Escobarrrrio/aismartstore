-- ===========================================================================
-- Retire the expected-value business ranking (20260730140000), superseded by
-- business_merchandising_engine (20260812153000)
-- ===========================================================================
--
-- WHY THIS IS BEING DROPPED, NOT JUST LEFT ALONE
-- -----------------------------------------------
-- Two real problems, found while wiring the replacement:
--
-- 1. Name collision. business_merchandising_engine defines its own
--    `score_business_product`, with a different (and more sensible) argument
--    order. Postgres allows same-name functions to coexist as long as their
--    signatures differ, but here both signatures share parameter name
--    `p_price` -- a call using named arguments (`p_price := ...`) is exactly
--    the ambiguous-overload situation this project already hit once today
--    (search_products, see 20260812000000) and had to fix. Not repeating
--    that with a second function.
--
-- 2. It doesn't actually do what its own comments say it does. Its
--    `expected_value = margin_rand x close_rate x repeat_factor` was
--    deliberately engineered so a bigger deal wouldn't automatically win
--    (its own header documents rejecting a first version for exactly that
--    failure). In practice, querying get_business_picks(12) against the live
--    catalogue right now returns results in near-strict ascending price
--    order (R15 208 -> R20 122 across the top 12) -- the decay isn't steep
--    enough against this catalogue's real margin distribution, so it still
--    functionally reproduces "biggest number first", just with extra
--    arithmetic in between. It also has zero real behavioural signal (no
--    paid-order or wishlist data anywhere in the formula) -- pure priors,
--    dressed as "expected value".
--
-- business_merchandising_engine's price factor cannot do this even in
-- principle: it's a fixed lookup band contributing 5% weight, not a
-- continuous function of price, and it's outweighed by demand (35%),
-- availability (20%) and real order/wishlist signal (10%).
--
-- product_costs itself is untouched -- it's load-bearing elsewhere (Admin
-- sourcing, axiz-sync/frontosa-sync cost tracking, category markup). Only
-- the ranking functions built on top of it for this one page are retired.
-- ===========================================================================

DROP FUNCTION IF EXISTS public.get_business_picks(integer);
DROP FUNCTION IF EXISTS public.score_business_product(numeric, numeric, boolean, text, text, text);
DROP FUNCTION IF EXISTS public.biz_close_rate(numeric, boolean);
DROP FUNCTION IF EXISTS public.biz_repeat_factor(numeric);
