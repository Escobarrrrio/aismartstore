# Changelog

## 2026-06-27 — Security lockdown, real logo, full i18n, tests

**Security (Supabase advisor: 8 critical, 7 warning — all addressed)**
- Fixed RLS policies that let any signed-up customer (not just admins) read/edit products, categories, store settings, all customers' orders + PII, all order line items, and all profiles. Root cause: several policies were `USING (true)` instead of checking the `admin` role.
- `cost_price` / `selling_price` / `margin_percentage` / `axiz_product_id` are no longer column-readable by `anon`/`authenticated` at all (was previously exposed to anyone with the public API key via `products` SELECT). Admin access now goes through `get_product_admin_view()`, a SECURITY DEFINER function that checks the admin role server-side.
- Removed anon write access to `ai_conversations` (was: anyone could overwrite any chat session).
- Locked down EXECUTE on SECURITY DEFINER functions (`handle_new_user`, `has_role`) that were callable by PUBLIC/anon by default.
- Excluded internal tables and cost/margin columns from the auto-generated GraphQL schema.
- Admin route (`/admin`) now actually checks the `admin` role (`useIsAdmin`) instead of only checking "is logged in" — previously any new customer signup landed in the full admin dashboard.
- Wired the new cost/margin RPC into the admin Products table (Margin % column), since this had been added to the schema but never surfaced anywhere.

**Logo / branding**
- Replaced the fabricated inline-SVG "N" mark with the real uploaded brand asset (`src/assets/logo.png`), which had been sitting unused in the repo since June 5th. `Logo.tsx` is now the single source of truth used by header, auth, footer, and admin sidebar.
- Replaced Lovable's placeholder heart favicon with a real favicon/touch-icon set generated from the actual logo.
- Replaced the Open Graph / Twitter share image (was pointing at Lovable's generic template image) with a branded one, so sharing the site link no longer shows Lovable's branding instead of ours.
- Removed a leftover template TODO comment from `index.html`.

**i18n**
- Extended full translation coverage (en/af/xh/zu/st) from Home-only to every customer-facing page: Products, Product Detail, Cart, Checkout, Auth, Reset Password, 404. Admin panel intentionally left untranslated (internal staff tool).

**Performance**
- Route-level code splitting (`React.lazy`): the Admin bundle (524KB, dozens of modules) no longer ships to customers who never visit `/admin`. Main customer bundle dropped from ~1.2MB to ~612KB.
- Fixed the Admin route rendering inside the storefront header/footer layout (was producing duplicate navigation chrome).

**Tests**
- Added Vitest + RTL test suite: Logo rendering/props, i18n completeness (regression guard for the partial-translation bug), and an Auth form smoke test. 15 tests, all passing.

## Unreleased

### Brand & UI consistency
- **Logo consolidation.** Introduced a single canonical `<Logo />` component at
  `src/components/Logo.tsx` rendering an inline SVG mark (cyan→violet→magenta
  brand gradient) plus the "Smart Store" wordmark. All previous logo
  implementations (`StoreHeader`, `Auth`, `ResetPassword`, `StoreFooter`,
  admin `AdminSidebar`) now consume this component with size/wordmark/invert
  props instead of bitmap assets or ad-hoc `<div>S</div>` placeholders. The
  PNG asset at `src/assets/logo.png` and `ai-smart-store-logo.png.asset.json`
  are no longer imported anywhere in app code.

### Internationalization (i18n)
- **Full hero/home translation coverage.** Audited every user-facing string on
  the homepage and hero section. Added keys for hero badge, headline parts,
  subtitle, CTAs, trust row, hero category cards, feature bar (free
  shipping / secure checkout / AI support / fast delivery), "Shop by Category"
  heading + 4 category short cards, featured-products copy, "Why Choose"
  benefits, AI assistant CTA block, and "Trusted Brands" label. Translations
  added for all five configured locales (`en`, `af`, `xh`, `zu`, `st`).
  `HeroSection.tsx` and `Index.tsx` now route every visible string through
  `react-i18next` `t()`. Brand names (Dell, HP, Yoco, etc.) are intentionally
  left untranslated.

### Visual polish
- **Animated shimmer headline.** New `.shimmer-text` utility class in
  `src/index.css` applies a slow (7s) linear gradient sweep across heading
  text using `background-clip: text`. Applied to hero "Technology" highlight,
  "Shop by Category" heading, and "Why Choose Smart Store?" heading.
  Honours `prefers-reduced-motion: reduce` — animation is disabled and the
  static brand gradient is shown instead.

### Auth reliability
- **Sign-in success feedback.** Added a "Welcome back" toast on successful
  sign-in so users get an explicit confirmation instead of a silent redirect.
  Sign-up now passes an explicit `emailRedirectTo` so confirmation emails
  return users to `/auth` on this project's origin. Existing forgot-password
  flow (`resetPasswordForEmail` → `/reset-password` recovery handler) was
  audited and verified end-to-end: it surfaces success and error toasts and
  the recovery page rejects expired/invalid links.

### Notes for maintainers
- When adding new homepage copy, add the English string to
  `src/lib/locales/en.json` and mirror it in `af/xh/zu/st` to keep coverage
  complete. The language switcher will silently fall back to `en` for missing
  keys, but that surfaces as untranslated text and should be avoided.
- The `<Logo />` component accepts `size`, `showWordmark`, `asLink`, and
  `invert` — prefer it over re-rendering the SVG inline anywhere new.
