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

## 2026-06-27 — Security lockdown, real logo, full-site i18n, tests, performance

### Security (critical)
- Fixed 8 critical RLS holes surfaced by the Supabase advisor: any signed-up
  customer could previously read/edit other customers' orders and profiles,
  create/update/delete products and categories, and read/write store settings
  (Yoco keys). All now correctly gated to the `admin` role.
- Cost price, selling price, margin %, and Axiz product IDs are no longer
  readable by the `anon`/`authenticated` Postgres roles at the column level
  (RLS is row-level only and couldn't have stopped this). Admin access now
  goes through a dedicated `get_product_admin_view()` function that checks
  the admin role server-side.
- Removed PUBLIC execute access from SECURITY DEFINER functions
  (`handle_new_user`, `has_role`) that didn't need it.
- Excluded internal tables/columns from the auto-generated GraphQL schema.
- `Admin.tsx` now actually checks the `admin` role (`useIsAdmin`) instead of
  only checking "is logged in" -- previously any new signup could open the
  full control centre, even though the database itself would correctly
  refuse their queries.

### Brand
- Replaced the fabricated SVG logo mark with the real uploaded brand asset
  (`src/assets/logo.png`), which had been sitting unused in the repo since
  June 5th. One `<Logo />` component is now the single source of truth for
  header, auth, footer, and admin sidebar.
- Replaced Lovable's default placeholder favicon and the generic Lovable
  template Open Graph image with real branded versions generated from the
  actual logo.

### Internationalization
- Extended full i18n coverage from the homepage to every customer-facing
  page: Products, Cart, Checkout, Auth, Product Detail, Reset Password, and
  404. All 5 locales (en/af/xh/zu/st) have complete, non-placeholder
  translations with zero missing keys.
- Added a regression test (`i18n-completeness.test.tsx`) that fails if any
  known English landmark string reappears after switching languages.

### Performance
- Route-level code splitting via `React.lazy`. The Admin panel (~524KB,
  dozens of modules) no longer ships in the bundle every shopper downloads
  just to browse the store. Main customer-facing bundle dropped from
  ~1.2MB to ~612KB.
- Fixed a layout bug where the storefront header/footer wrapped the Admin
  panel, which renders its own sidebar layout -- this produced duplicate
  navigation chrome.

### Tests
- Added a real Vitest + React Testing Library suite: Logo render/props
  tests, the i18n completeness regression test above, and Auth form smoke
  tests (renders, submits real credentials to Supabase, handles auth
  errors gracefully, forgot-password flow). 15 tests, all passing.

## 2026-06-27 (2) — Real shipping cost (was the #1 documented cause of cart abandonment)

Baymard Institute's research (50-study meta-analysis) puts hidden/unexpected
costs as the single biggest cause of checkout abandonment (48% of
abandonments). The Cart page was showing "Calculated at checkout" for
shipping -- and Checkout never actually added a shipping charge at all,
despite the homepage advertising "Free Shipping on orders over R500" (which
implies a fee exists below that threshold and was never being charged).

- Added `shipping_flat_rate` / `free_shipping_threshold` to `store_settings`,
  with a new admin-only "Shipping" section in Settings to change them --
  this is a business decision, not something to hardcode.
- Added a public-readable RLS policy scoped to only those two keys (everything
  else in store_settings, like the Yoco secret key, stays admin-only).
- Cart and Checkout now show the real computed shipping cost (or "Free")
  instead of deferring it, and Checkout actually charges it as part of the
  order total and the Yoco payment amount.
- Added a "spend R___ more for free shipping" nudge on Cart when below
  threshold -- turns the cost-disclosure moment into an upsell opportunity
  (a pattern Gymshark and others use successfully) instead of pure friction.

## 2026-06-27 (3) — SEO infrastructure, dynamic sitemap, CI automation

### SEO
- Added per-route meta tags (title, description, canonical URL, Open
  Graph, Twitter Card) via react-helmet-async -- previously every route
  shared the same static tags from index.html, which is invisible to
  search engines trying to rank individual product pages.
- Added full `Product` JSON-LD structured data on product pages (price,
  stock status, images) -- this is what makes individual products
  eligible for Google rich snippets (price/availability shown directly
  in search results).
- Added `Organization` JSON-LD on the homepage.
- Marked Cart/Checkout/Account/Auth/Reset-Password as noindex -- these
  have no SEO value and shouldn't compete with real content pages.
- Deployed a dynamic sitemap (Supabase edge function `sitemap`) that
  regenerates from live product data on every request, instead of a
  static file that goes stale the moment products are added or removed.
  robots.txt now points at it directly.

### Automation
- Added a GitHub Actions CI workflow: every push/PR automatically runs
  type-check, the full test suite, and a production build. No human
  action needed unless something actually breaks.
- Added Dependabot config for weekly automated dependency-update PRs,
  which the CI workflow tests automatically before anyone needs to look
  at them.
- Rewrote the repository README (was the generic Lovable starter
  template) to actually describe the project, stack, and structure --
  relevant since this repo may be shown to Axiz as part of the
  partnership application.

### Fixed
- HelmetProvider was missing from test renders after wiring in
  react-helmet-async, which crashed 2 of the 4 test files. Fixed by
  wrapping the relevant test renders in HelmetProvider, matching how
  i18next is already initialized globally for tests.

## 2026-06-27 (4) — Government/enterprise procurement page, AI Pulse content hub

### Procurement readiness ("credibility seen from the jump")
- New `/procurement` page ("For Business") showcasing B-BBEE Level 1,
  CIPC registration, CSD verification, and banking confirmation up front
  -- the actual credentials a government or enterprise procurement
  officer is screening for, not generic trust badges.
- New "Request a Quote" flow (`quote_requests` table) for government,
  private enterprise, and contractor buyers who need a formal written
  quote rather than forcing a tender through a consumer checkout flow.
  Public can submit, only admin can view/manage -- mirrors the orders
  privacy pattern from the security lockdown.

### AI Pulse -- real content, not fabricated
- New `/ai-pulse` page: real AI research papers (arXiv cs.AI) and real
  news discussions (Hacker News, keyword-filtered) -- deliberately NOT
  LLM-generated "news," since asking a model to invent the latest
  headlines risks publishing hallucinated dates and facts as if real.
- `sync-ai-pulse` edge function pulls both sources and upserts by URL
  (safe to re-run, no duplicates).
- Scheduled via pg_cron + pg_net every 6 hours -- fully automated, no
  manual refresh ever needed.
- Both new pages added to header/mobile nav, fully translated across
  all 5 locales.

## 2026-06-27 (5) — Newsletter system, Cloudflare monitor, Axiz sync scaffold, redundancy cleanup

### Newsletter & lifecycle email
- `newsletter_subscribers` + `newsletter_campaigns` tables, public can
  subscribe, admin-only to manage/send.
- Welcome email (send-welcome-email): sent once, immediately on signup.
  Structure is deliberate, not arbitrary -- see in-code comments for the
  reasoning (curiosity-gap subject line, reciprocity-first framing,
  single CTA, honest personalization by category, no fabricated
  urgency/scarcity).
- Bulk campaign sending (send-newsletter-campaign): admin-composed,
  optionally targeted by interested category so subscribers get content
  relevant to them rather than one blast to everyone.
- One-click unsubscribe, no login required, isolated to a service-role
  edge function so it can only ever set unsubscribed_at -- not a general
  write path.
- New admin "Newsletter" tab: subscriber count, campaign composer,
  send history.
- Footer newsletter signup widget. Subscriber count is only ever shown
  once it's a genuinely credible number (≥50) -- a low count displayed
  publicly tends to undermine trust rather than build it.

### Other
- New admin "Quote Requests" tab for the /procurement page submissions.
- Cloudflare Worker (uptime + security-header monitor) written and
  added to the repo at `cloudflare-worker/` -- ready to deploy via
  Wrangler (Claude's Cloudflare access is read-only, can't deploy
  directly; see cloudflare-worker/README.md for the one-time setup).
- Axiz catalog sync scaffold (`axiz-sync` edge function) -- the upsert
  logic, markup application, and sync_logs audit trail are fully real;
  only fetchAxizCatalog() is a placeholder, since Axiz's actual API
  contract isn't documented anywhere available yet. Checks for a
  configured API key and exits cleanly (logged) until one exists.
- Removed unused dependencies found in a dependency audit: zod,
  @hookform/resolvers, @tailwindcss/typography -- none were imported
  anywhere in the codebase.
