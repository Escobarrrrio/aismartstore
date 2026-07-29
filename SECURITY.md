# Security Policy

This is a private, proprietary repository for AI Smart Store, operated by
AI Job Chommie (Pty) Ltd. It isn't open to public contributions, but
security reports are taken seriously regardless of source.

## Reporting a vulnerability

If you've found a security issue (a way to access another customer's
data, bypass payment, escalate privileges, etc.), please report it
privately rather than opening a public issue:

**privacy@aismartstore.co.za**

Please include:
- What you found and how to reproduce it
- What you believe the impact is
- Whether you've already attempted to exploit it beyond what's needed to demonstrate it

We aim to acknowledge reports within 48 hours.

## Current security posture

- Row-Level Security is enforced on every table; the principle of least
  privilege is applied at the database layer, not just hidden in the UI.
- Admin-only data (cost prices, margins, store settings/API keys) is
  isolated in separate tables with admin-role-gated RLS policies, and
  excluded from the auto-generated GraphQL schema.
- SECURITY DEFINER database functions have EXECUTE explicitly restricted
  to the roles that actually need them.
- Passwords are never stored or transmitted in plaintext; auth is handled
  by the backend's auth service, not custom code.
- See `CHANGELOG.md` for the dated history of security fixes, including
  the full RLS audit performed on 2026-06-27.

## Accepted dependency advisories

Reviewed rather than silently carried. Each entry says why it is accepted and
what would change the decision.

### `GHSA-qwww-vcr4-c8h2` — react-router RSC Mode CSRF bypass (high)

Affects `react-router >=7.12.0 <8.3.0`; we run 7.18.2.

**Not applicable.** The advisory requires React Router's **RSC (React Server
Components) mode**, where an action can execute before a 400 response. This
storefront is a Vite single-page app using `<BrowserRouter>` with `<Routes>`,
with no server runtime, no RSC and no router actions, so the vulnerable code
path does not exist in the shipped bundle.

Staying on 7.18.2 is the deliberate choice:

- 7.18.2 is the current `latest` on npm, and it **fixes** the three advisories
  that *were* applicable to us — the open-redirect-via-backslash issue
  (`GHSA-wrjc-x8rr-h8h6`), open redirect leading to XSS
  (`GHSA-jjmj-jmhj-qwj2`), and `deserializeErrors()` constructor injection.
- npm's suggested "fix" is a **downgrade** to 7.11.0, which sits inside the
  vulnerable range of those open-redirect advisories. Trading a theoretical
  RSC issue for a real one we can be attacked through is the wrong way round.
- The first version clearing both is 8.3.0, which requires **React >=19.2.7**.
  We are on React 18.3.1, so that is a full React 19 migration across every
  component and the UI library — far more risk than the advisory justifies.

**Revisit when** this app moves to React 19, at which point go straight to
react-router 8.3.0 or later. Also revisit immediately if RSC mode or router
actions are ever introduced, because that makes the advisory live.

Separately, the open-redirect class was also fixed in our *own* code: the
`?redirect=` guard in `Auth.tsx` accepted `/\evil.com`, which browsers
normalise to `//evil.com`. See `src/lib/safe-redirect.ts` and its tests.

### Dev-only advisories

`vite`, `esbuild`, `eslint`, `minimatch` and `brace-expansion` findings affect
the development server and tooling only. They are not part of the production
bundle and cannot be reached by a visitor to the live site.

## Scope

In scope: the storefront, the admin panel, and the database layer
described in this repository.

Out of scope: the underlying hosting platform's own infrastructure
security (that's their responsibility, not something a report here can
affect), and social engineering attempts against AIJC staff.
