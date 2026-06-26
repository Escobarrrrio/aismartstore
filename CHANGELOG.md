# Changelog

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
