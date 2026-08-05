# AI Smart Store — Handover & Due Diligence Pack

**Asset:** aismartstore.co.za — a South African consumer + B2B technology e-commerce platform
**Prepared:** 4 August 2026
**Every figure in this document was read from the production database or the
hosting analytics on that date. None is projected, rounded up, or estimated.
Section 12 tells a buyer how to reproduce each one themselves.**

---

## 1. What is being sold

A working, deployed e-commerce platform with a live distributor integration, an
88k-line catalogue pipeline, and a substantial amount of custom operational
engineering — payment reconciliation, fraud/abuse guardrails, automated
catalogue hygiene, and a monitoring subsystem.

It is **not** a business with trading history. See section 2. A buyer is
acquiring built software, a domain with early organic search presence, a
distributor relationship, and the compliance groundwork — not a revenue stream.

Stating that plainly here is deliberate. It is the first thing diligence will
establish, and a pack that obscures it loses the deal at the point where trust
matters most.

---

## 2. Honest position

| | |
|---|---|
| Paid orders, all time | **0** |
| Revenue, all time | **R0** |
| Orders on record | 0 (7 test orders placed by the owner were deleted 4 Aug) |
| Registered customers | 8 |
| Newsletter subscribers | 5 |
| Quote requests | 0 |

**No payment gateway has processed a single transaction.** `payment_events` —
the audit table both gateways write to on every attempt, success or failure —
has **zero rows**. This is not "payments are on test keys, deliberately"; it is
that neither configured gateway has been proven end-to-end:

- **Yoco**: not configured. The live secret key was removed during earlier
  test-mode work and has not been replaced. Every Yoco checkout would fail
  before reaching Yoco at all.
- **PayFast**: merchant ID and key are set and the `payfast_enabled` flag is
  on, but the merchant account's business-verification documents are still
  under review with PayFast as of 4 August. Whether it can settle a live
  transaction today is unconfirmed — the zero rows in `payment_events` mean it
  has not been tested, not that it works.

Getting either gateway to a proven state is a configuration and verification
task, not development work — see section 10.

**What this means for valuation:** this is an asset sale of software plus
domain, priced on build cost and strategic value, not a multiple of earnings.

---

## 3. Traffic (1 July – 4 August 2026)

| | |
|---|---|
| Visitors | 184 |
| Pageviews | 564 |
| Pages per visit | 3.07 |
| Bounce rate | 59% |
| Mean session | ~6m 26s |

**Sources:** Direct 109 · google.com 57 · github.com 8 · other 11
**Countries:** South Africa 98 · Unknown 56 · United States 21 · other 5
**Devices:** Desktop 129 · Mobile 52
**Top pages:** `/` 150 · `/products` 41 · `/auth` 29 · `/ai-pulse` 27 · `/procurement` 17

The site went live on ~9 July 2026, so this is essentially its entire life. The
57 organic Google sessions in the first month, with no paid acquisition and no
backlink building, indicate the SEO work (structured data, sitemap, generated
product content) is indexing. Three pageviews per visit and a six-minute mean
session on a store with no marketing is engagement worth noting — but the
sample is small and should be treated as directional only.

---

## 4. Catalogue

| | |
|---|---|
| Products, total rows | 153,196 |
| Active (visible to shoppers) | 3,488 |
| Active with a real photograph | 3,485 of 3,488 |
| **Currently in stock** | **176** |

The gap between 153k rows and 3.4k active is by design: the Axiz feed is
ingested whole, then filtered by price sanity, image validity, category
coverage and stock. Products failing any gate are deactivated rather than
deleted, so the pipeline is reversible and auditable.

**The 176 in-stock figure is the number that matters commercially** and is the
honest limit of what can be sold today. It is a function of the distributor's
stock position, not of the platform.

---

## 5. Architecture

- **Frontend:** React 18 + TypeScript, Vite, Tailwind, shadcn/ui, React Router v7
- **Backend:** Supabase — PostgreSQL with Row-Level Security throughout, Auth, Storage, Edge Functions (Deno)
- **Hosting:** Lovable-managed deployment; custom domain aismartstore.co.za
- **Error tracking:** Sentry
- **i18n:** 13 locales, completeness enforced by a unit test
- **CI:** GitHub Actions — type-check/test/build, Deno edge-function tests, npm audit, Supabase security gate, Playwright E2E, Lighthouse

**30 edge functions**, including: `axiz-sync`, `create-yoco-checkout`,
`yoco-webhook`, `payfast-webhook`, `notify-order`, `sync-courier-tracking`,
`validate-product-images`, `engine-room-analyst`, `ai-chat`, `admin-ai-agent`.

Deployment of edge functions is automated on merge to `main`
(`.github/workflows/deploy-functions.yml`) once `SUPABASE_ACCESS_TOKEN` and
`SUPABASE_PROJECT_ID` are set as repository secrets.

---

## 6. Integrations

| Integration | Purpose | Status |
|---|---|---|
| **Axiz** (distributor) | OAuth2 catalogue + pricing feed, syncs every 15 min | Live, working |
| **Yoco** | Card payments | Built, **not configured** — see §2 |
| **PayFast** | Card / Capitec Pay / EFT | Built, `payfast_enabled` on, **KYC pending** — see §2 |
| **The Courier Guy** | Shipping rates + tracking sync every 30 min | Live |
| **Resend** | Transactional email | Live; sending domain needs verification (§10) |
| **Telnyx** | SMS OTP | Configured, capped |
| **AI gateway / OpenAI** | Shop assistant, product content, ops analyst | Live, capped |
| **Sentry** | Error tracking | Live |
| **Google OAuth** | Sign-in | Live |

---

## 7. Automated operations

Thirteen scheduled jobs run without human involvement:

| Job | Schedule |
|---|---|
| `axiz-sync` | every 15 min |
| `sync-courier-tracking` | every 30 min |
| `refresh-product-facets`, `stock-sanity-check-hourly` | hourly |
| `ai-pulse-enqueue-feeds` / `ingest-feeds`, `refresh-home-showcase`, `engine-room-watch` | every 3 h |
| `sync-ai-pulse-every-6h` | every 6 h |
| `sync-exchange-rates-daily`, `ai-pulse-daily-digest`, `cleanup-blocked-products-daily`, `guardrail-sweep` | daily |

The practical meaning for a buyer: the catalogue keeps itself current, priced
and photographed, and the store self-monitors, without a daily operator.

---

## 8. Security and cost control ("the Engine Room")

This is the most unusual engineering in the asset and the part most likely to
matter to a technical buyer. It exists because an AI-built store with live API
keys is a standing invitation to have those keys drained by a third party.

- **Token-bucket rate limiting** (`rl_take`) — atomic refill-and-spend in a single statement, so a concurrent burst cannot over-draw.
- **Hard spend caps per provider** (`spend_guard`) with schema-level ceilings that cannot be raised through the API. **There is no admin bypass, deliberately** — a bypass is the first thing a stolen admin session reaches for. Day boundaries use Africa/Johannesburg, not UTC.
- **Threat engine** — 26 signatures across phishing, spam and injection; normalises zero-width characters and whitespace before matching; quarantines rather than rejects, so hostile payloads are retained whole for inspection; escalating blocks doubling per offence to a 7-day cap.
- **Audit trail** — `security_events` is writable by no role through the API; cap changes are logged, with loosening recorded at higher severity than tightening.
- **TRUNCATE revoked** from `anon` and `authenticated` across all 43 tables plus default privileges (TRUNCATE is not subject to RLS — a role holding it empties a table regardless of policy).
- **Engine Room analyst** — reads a system snapshot every 3 h. Severity is decided by *rules*, not the model; the model only writes the human-readable summary. An AI-judged monitor stops judging exactly when the AI budget is exhausted, which is a symptom of the thing being monitored.

Current caps (rand):

| Provider | Daily | Monthly | Daily calls |
|---|---|---|---|
| ai-gateway | 40 | 600 | 2,000 |
| openai | 40 | 600 | 2,000 |
| telnyx-sms | 60 | 700 | 600 |
| resend-email | 30 | 400 | 5,000 |
| axiz | — | — | 8,000 |
| courier-guy | — | — | 6,000 |
| exchange-rates | — | — | 200 |

**Maximum uncontrolled API exposure is therefore roughly R170/day, R2,300/month**, enforced in the database rather than by convention.

---

## 9. Compliance (South Africa)

- **POPIA / PAIA** — dedicated `/compliance` page, PAIA manual, cookie-consent banner with Google Consent Mode v2.
- **Consumer Protection Act** — stock status is never misrepresented; out-of-stock items display as such rather than being made purchasable.
- **Data retention** — `data_retention_policy` table with a written rationale per table, swept nightly (`retention_sweep`). `compliance_access_log` is retained 3 years as audit evidence; orders and profiles are deliberately never swept (SARS requires 5 years, and deleting order history is a business decision, not housekeeping).
- **B-BBEE** — Level 1 EME, 100% black-owned, 135% procurement recognition. Registration 2025/599261/07 · CSD MAAA1656325. *Note: B-BBEE status attaches to the current owner and does not transfer with the asset.*

---

## 10. Known gaps — disclose these

Listing these is not weakness. A buyer finds them anyway, and finding them
undisclosed is what kills a deal.

1. **No payment gateway is proven live.** Yoco has no secret key configured. PayFast has credentials set but the merchant account is awaiting document verification with PayFast — whether it can settle a live transaction is unconfirmed. Getting one gateway to a proven state (a real R1 transaction, confirmed in `payment_events` and the order flipping to paid) is the single most important thing standing between this asset and "ready to trade."
2. **Resend sending domain is unverified**, so `support@aismartstore.co.za` outbound mail — including Engine Room alerts — is not being delivered. DNS records at Resend fix it.
3. **E2E tests do not run in CI** — `E2E_SUPABASE_URL` / `E2E_SUPABASE_SERVICE_ROLE_KEY` repo secrets are unset. The suite exists and is comprehensive; the workflow now skips loudly rather than failing red.
4. **177 in-stock products.** Commercial ceiling until stock is broadened or a second distributor is added.
5. **Six manually-sourced products** carry supplier-researched pricing recorded in `specifications` jsonb rather than an automated feed; these need manual re-checking.
6. **Axiz upstream availability** — the distributor's catalogue API was degraded for a period around 3–4 August, causing the sync to stall on individual pages. A guard now distinguishes a broken page from a distributor outage and holds position safely during the latter rather than losing catalogue coverage; see `supabase/functions/axiz-sync/stall.ts`.
7. **AI Pulse feeds** — several South African news sources (mybroadband, businesstech) return 403 to automated fetches behind Cloudflare.
8. **Lovable platform dependency** — hosting and deploys run through Lovable. Migrating to another host is feasible (it is a standard Vite + Supabase app) but is work a buyer should scope. **A migration path is now built and tested**: `docs/migration/` contains the full schema as one file, a `migrate.sh` verified end to end against two real PostgreSQL 16 databases, and a step-by-step runbook. A second Supabase project (`okejdzkftwhccplyfluf`, eu-west-1) is provisioned and waiting. Two genuine platform couplings remain and both have documented replacements: the AI gateway (`LOVABLE_API_KEY`, replaceable with an OpenAI key already supported in `_shared/ai-provider.ts`) and authentication emails (replaceable with Supabase's own SMTP settings pointed at Resend — business email already goes through Resend directly).

9. **The database could not be rebuilt from the repository until 5 August 2026, and this was only discovered by trying it.** Replaying all 85 migrations into an empty PostgreSQL 16 cluster produced 43 of the live database's 51 tables. Eight tables had no `CREATE TABLE` anywhere in source control; three more were missing columns that exist in production, including `products.audience`, which the home-page merchandising engine partitions on. Closed by two migrations; the rebuild now reproduces all 51 tables, all 90 RLS policies and both views exactly, verified by per-table column-signature hash against the live database.

   The same exercise found a defect that existed **only** in source control: `log_order_changes()` used `COALESCE` across a `text` and an enum column, which aborts the INSERT it fires on — every checkout would have failed on a rebuilt database, at the last step, after payment. The live database carried a cast that had been applied directly and never written back into a migration. Both are fixed and the fix is tested.

   A buyer should read this as what it is: the schema is now genuinely portable and that claim is mechanically verifiable (§12), but the history of direct-to-database changes means anything not exercised should be re-verified rather than assumed.

---

## 11. Transfer checklist

**Accounts to transfer**
- Domain registrar — aismartstore.co.za
- Supabase project (`xwiqubcilptxzvdigsmp`) — or a full database + storage export. A second, buyer-ready project (`okejdzkftwhccplyfluf`, eu-west-1) is provisioned; `docs/migration/RUNBOOK.md` moves the store onto it.
- Lovable project / hosting
- GitHub repository `Escobarrrrio/aismartstore`
- Yoco merchant account (or buyer opens their own)
- Axiz distributor account — **confirm assignability with Axiz before signing; distributor agreements frequently are not transferable**
- Resend, Sentry, Telnyx, Google OAuth client

**Secrets to rotate on handover — every one, without exception**
`SUPABASE_SERVICE_ROLE_KEY` · `YOCO_SECRET_KEY` · `PAYFAST_MERCHANT_ID`/`_KEY` ·
`AXIZ_CLIENT_ID`/`_SECRET` · `COURIER_GUY_API_KEY` · `RESEND_API_KEY` ·
`TELNYX_API_KEY` · `OPENAI_API_KEY` · `INTERNAL_CRON_SECRET` · Google OAuth client secret

**Records to hand over**
- Company registration and B-BBEE affidavit (for information — status does not transfer)
- CSD registration
- This document, `docs/ENGINE-ROOM.md`, `docs/AXIZ-INTEGRATION.md`, `docs/POPIA-PAIA.md`

---

## 12. How a buyer verifies all of this

Nothing above needs to be taken on trust.

| Claim | How to check |
|---|---|
| Revenue and orders | `SELECT count(*), sum(total_amount) FROM orders WHERE order_status IN ('paid','shipped','delivered');` |
| Catalogue and stock | `SELECT count(*) FROM products WHERE is_active AND stock_status='in_stock';` |
| Traffic | Hosting analytics dashboard, or Google Search Console |
| Automation is real | `SELECT jobname, schedule, active FROM cron.job;` then `sync_logs` for actual run outcomes |
| Spend caps are enforced | `SELECT * FROM spend_caps;` — then try to raise one past its CHECK ceiling and watch it be rejected |
| Code quality | Repository history, GitHub Actions run history, `npm test` (138 tests), `npx tsc --build --force` |
| Security posture | Supabase advisors/linter; RLS policies in `supabase/migrations/` |
| **The asset is portable** | Create an empty PostgreSQL 16 database, run `psql -f docs/migration/schema.sql`, then compare it to the live database: `SELECT table_name, md5(string_agg(column_name\|\|':'\|\|data_type\|\|':'\|\|is_nullable, ',' ORDER BY column_name)) FROM information_schema.columns WHERE table_schema='public' GROUP BY table_name ORDER BY 1;` — all 51 rows should match. This is the check that failed before 5 August 2026 and now passes. |

Run them in front of the seller. Anything that does not reconcile with this
document is a question worth asking before money changes hands.
