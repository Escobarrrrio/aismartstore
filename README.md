<div align="center">

# AI Smart Store

**South Africa's premium AI & technology e-commerce platform.**

![License](https://img.shields.io/badge/license-Proprietary-blue)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-Postgres-3ECF8E?logo=supabase&logoColor=white)
![Languages](https://img.shields.io/badge/i18n-13%20languages-orange)
![Tests](https://img.shields.io/badge/tests-passing-brightgreen)

[Live Site](https://aismartstore.lovable.app) · [Report an Issue](https://github.com/Escobarrrrio/aismartstore/issues)

</div>

---

## What this is

AI Smart Store is the e-commerce platform for **AI Job Chommie Pty Ltd**, built to sell AI hardware,
networking equipment, computing, and enterprise software — sourced through a distribution
partnership with **Axiz (Alviva Holdings)** — to South African businesses, government and private
procurement, and international customers.

The platform is built for scale and credibility from the start, not bolted on after launch:

- Designed to carry a full distributor catalogue (thousands of SKUs), with margin tracking and
  cost isolation built into the data model from day one.
- A dedicated procurement page surfacing B-BBEE Level 1, CIPC, and CSD verification up front —
  built for government and enterprise buyers who screen for exactly that before anything else.
- 13 languages covering South Africa's main official languages plus major international
  languages, with automatic right-to-left layout for Arabic.
- An AI content hub pulling real, sourced research and news (never LLM-fabricated) on a fully
  automated schedule.

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui |
| Backend | Postgres, Auth, Edge Functions, Storage, scheduled jobs (pg_cron) |
| Payments | Yoco |
| Email | Resend (transactional + newsletter campaigns) |
| i18n | react-i18next — 13 languages, full RTL support |
| Testing | Vitest, React Testing Library |
| Monitoring | Standalone Cloudflare Worker (uptime + security headers) |

## Highlights

- **Row-level security audited and locked down** — every table enforces the principle of least
  privilege; customers can only ever see their own data, admin-only data (margins, settings) is
  isolated at the database level, not just hidden in the UI.
- **Full internationalization** across every customer-facing page and 13 languages, not just
  the homepage in English.
- **Code-split by route** — the admin control centre (~30 modules) never ships to a customer
  just browsing the storefront.
- **Real automated test suite** — component tests, an i18n-completeness regression guard, and
  auth flow smoke tests, run on every push.
- **Configurable shipping**, transparent at the cart stage rather than sprung at checkout.
- **Government/enterprise procurement page** with a formal quote-request flow, separate from
  the consumer checkout.
- **Newsletter system** with a welcome sequence and category-targeted campaigns.

## Project structure

```
src/
  pages/          Route-level pages (Home, Products, Cart, Checkout, Admin, Procurement, ...)
  components/     Shared UI, including the admin control centre modules
  contexts/       Cart, Product, and Locale React contexts
  hooks/          Shared hooks (admin-role check, shipping settings, etc.)
  lib/            i18n setup, currency formatting, locale JSON files (13 languages)
  integrations/   Database client + generated types
  test/           Vitest test suite
supabase/
  migrations/     Database schema and RLS policy history (applied in order)
  functions/      Edge functions (checkout, notifications, AI chat, newsletter,
                   dynamic sitemap, AI content sync, distributor catalog sync)
cloudflare-worker/
                  Standalone uptime + security-header monitor (deploy separately)
```

## Local development

```bash
npm install
npm run dev      # start the dev server
npm test         # run the test suite
npm run build    # production build
```

Requires Node.js + npm — see [nvm](https://github.com/nvm-sh/nvm) if you need to install them.

## License

Proprietary — © AI Job Chommie Pty Ltd. All rights reserved.
