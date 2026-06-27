<div align="center">

# AI Smart Store

**South Africa's premium AI & technology e-commerce platform.**

[Live Site](https://aismartstore.lovable.app) · [Report an Issue](https://github.com/Escobarrrrio/aismartstore/issues)

</div>

---

## What this is

AI Smart Store is the e-commerce platform for **AI Job Chommie Pty Ltd**, built to sell AI hardware,
networking equipment, computing, and enterprise software to South African businesses — sourced through
a distribution partnership with **Axiz (Alviva Holdings)**.

The platform is built for scale from the start: it's designed to carry Axiz's full catalogue
(thousands of SKUs) once the distribution API integration goes live, with margin tracking,
multi-language support, and an operations dashboard built in from day one rather than bolted on later.

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui |
| Backend | Supabase (Postgres, Auth, Edge Functions, Storage) |
| Payments | Yoco |
| i18n | react-i18next — English, Afrikaans, isiXhosa, isiZulu, Sesotho |
| Testing | Vitest, React Testing Library |
| Hosting / CI | Lovable (build & deploy), GitHub (source of truth) |

## Highlights

- **Row-level security audited and locked down** — every table enforces the principle of least
  privilege; customers can only ever see their own data, admin-only data (margins, settings) is
  isolated at the database level, not just hidden in the UI.
- **Full internationalization** across every customer-facing page, not just the homepage.
- **Code-split by route** — the admin control centre (~30 modules) never ships to a customer
  just browsing the storefront.
- **Real automated test suite** — component tests, an i18n-completeness regression guard, and
  auth flow smoke tests, run on every push.
- **Configurable shipping**, transparent at the cart stage rather than sprung at checkout.

## Project structure

```
src/
  pages/          Route-level pages (Home, Products, Cart, Checkout, Admin, ...)
  components/     Shared UI, including the admin control centre modules
  contexts/       Cart, Product, and Locale React contexts
  hooks/          Shared hooks (admin-role check, shipping settings, etc.)
  lib/            i18n setup, currency formatting, locale JSON files
  integrations/   Supabase client + generated types
  test/           Vitest test suite
supabase/
  migrations/     Database schema and RLS policy history (applied in order)
  functions/      Edge functions (Yoco checkout, order notifications, AI chat)
```

## Local development

```bash
npm install
npm run dev      # start the dev server
npm test         # run the test suite
npm run build    # production build
```

Requires Node.js + npm — see [nvm](https://github.com/nvm-sh/nvm) if you need to install them.

## Working on this project

This repository is synced bidirectionally with [Lovable](https://lovable.dev/projects/709f70aa-425c-4590-a3c9-ac6ccd24459b).
Changes pushed here are pulled into Lovable automatically, and changes made in Lovable are committed
back here. Either workflow is safe to use.

## License

Proprietary — © AI Job Chommie Pty Ltd. All rights reserved.
