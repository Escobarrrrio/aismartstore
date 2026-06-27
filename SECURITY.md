# Security Policy

This is a private, proprietary repository for AI Smart Store, operated by
AI Job Chommie (Pty) Ltd. It isn't open to public contributions, but
security reports are taken seriously regardless of source.

## Reporting a vulnerability

If you've found a security issue (a way to access another customer's
data, bypass payment, escalate privileges, etc.), please report it
privately rather than opening a public issue:

**fsteyn@rocketmail.com**

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

## Scope

In scope: the storefront, the admin panel, and the database layer
described in this repository.

Out of scope: the underlying hosting platform's own infrastructure
security (that's their responsibility, not something a report here can
affect), and social engineering attempts against AIJC staff.
