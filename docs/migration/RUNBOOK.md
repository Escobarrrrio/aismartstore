# Moving AI Smart Store off managed hosting

This is the whole job, in order, with the parts that need a human clearly
marked. Budget an evening. Nothing here is irreversible until step 8 — up to
that point the live store keeps running untouched and the new project is just
sitting there, so there is no moment where the shop is down and you are
hoping.

The new project already exists: **`okejdzkftwhccplyfluf`** (eu-west-1, free
tier), in the `AI Smart Store` organisation.

---

## Why some of this cannot be automated

Three walls, and it is worth knowing which is which so you do not go looking
for a setting that does not exist:

| Wall | Consequence |
|---|---|
| Agent sandboxes cannot open raw Postgres connections (port 5432) | The data copy has to run from your laptop. That is what `migrate.sh` is. |
| Secrets are write-only once set | Nobody and nothing can read `AXIZ_CLIENT_SECRET` back out. They have to be re-entered from wherever you originally got them. |
| Storage objects are files behind an HTTP API, not rows | `pg_dump` will not bring the product images across. Step 6. |

---

## Before you start

Install PostgreSQL 16 client tools if you have not (you said you already
downloaded PostgreSQL — `psql --version` should print 16.x).

Get both connection strings. In each project's dashboard: **Connect** →
**Direct connection**. Not the pooler — `pg_dump` needs session mode.

```bash
export SOURCE_DB_URL='postgresql://postgres:PASSWORD@db.xwiqubcilptxzvdigsmp.supabase.co:5432/postgres'
export TARGET_DB_URL='postgresql://postgres:PASSWORD@db.okejdzkftwhccplyfluf.supabase.co:5432/postgres'
```

---

## 1. Move the database  *(script)*

```bash
cd docs/migration
./migrate.sh
```

It creates the extensions, loads `schema.sql`, copies the accounts, copies
every table, and prints a source-vs-target row count for each one at the end.
Re-runnable — it truncates before it loads, so a failed run leaves nothing
half-merged.

Run it once now, and again with `DATA_ONLY=1` immediately before step 8, to
pick up anything that happened on the live store in between.

The script has been tested end to end against two real PostgreSQL 16
databases: 925 source products became the 25 active ones on the target with no
orphaned cost rows, orders and their audit trail copied exactly once, and
`products.search_vector` — a generated column — was recomputed rather than
copied.

**The catalogue.** The source database is 456MB, of which 406MB is `products`
and 23MB is `product_costs`. About 172,000 of the ~175,000 product rows are
`is_active = false` — distributor SKUs that failed the price-sanity, image or
category gates and are invisible on the storefront. They are not customer data
and the Axiz sync rebuilds them. The script copies only the active catalogue by
default, which is what takes the database from 456MB to a few MB and inside the
free tier. `KEEP_INACTIVE=1 ./migrate.sh` copies everything.

**This is the one that catches people out:** step 3 of the script copies
`auth.users` and `auth.identities`. Skip it and every existing customer's
login stops working — they are not missing from the site, they simply cannot
sign in, which is worse, because nothing looks broken.

---

## 2. Deploy the edge functions  *(script)*

32 functions.

```bash
npx supabase link --project-ref okejdzkftwhccplyfluf
npx supabase functions deploy
```

---

## 3. Turn on Google sign-in  *(dashboard)*

Authentication → Providers → Google. Same client ID and secret as the old
project, plus the new callback URL:

```
https://okejdzkftwhccplyfluf.supabase.co/auth/v1/callback
```

Add it to the **authorised redirect URIs** on the Google Cloud OAuth client
too, or sign-in fails with `redirect_uri_mismatch`.

---

## 4. Re-enter the secrets  *(dashboard — nobody can do this for you)*

Edge Functions → Secrets. These are write-only, so they must come from the
original source (Axiz portal, Resend dashboard, Yoco dashboard, etc.), not
from the old project.

**Needed for the store to function:**

| Secret | Where it comes from | Breaks if missing |
|---|---|---|
| `AXIZ_CLIENT_ID` / `AXIZ_CLIENT_SECRET` / `AXIZ_SCOPE` | Axiz developer portal | The whole catalogue stops refreshing |
| `RESEND_API_KEY` | Resend | Order confirmations, newsletter, all alerts |
| `ORDER_FROM_ADDRESS` | your choice | Emails send from the wrong address |
| `YOCO_SECRET_KEY` / `YOCO_WEBHOOK_SECRET` | Yoco dashboard | Checkout |
| `COURIER_GUY_API_KEY` | Courier Guy | Tracking updates |
| `INTERNAL_CRON_SECRET` | generate a new one | The hourly stock sanity check |
| `TELNYX_API_KEY` | Telnyx | SMS OTP |
| `SENTRY_DSN` | Sentry | Error reporting only |
| `SLACK_ALERT_WEBHOOK_URL` | Slack | Alerting only, optional |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are
injected automatically — do not set them by hand.

**Vault secrets** (Database → Vault, separate from the above — the scheduled
jobs read these, not the edge-function secrets):

- `email_queue_service_role_key` — the new project's service_role key
- `internal_cron_secret` — the same value you used for `INTERNAL_CRON_SECRET`

Without those two, every scheduled job raises and nothing runs.

---

## 5. Replace the two hosting-provider dependencies  *(dashboard)*

Two things in this codebase currently run on the hosting provider's own
services and will stop working the moment you leave. Both have clean
replacements already supported by the code.

**AI features** — the chat widget, the admin agent and the engine-room analyst
call the provider's AI gateway via `LOVABLE_API_KEY`. `_shared/ai-provider.ts`
already prefers an OpenAI key when one is configured, so the fix is a row, not
a code change:

```sql
INSERT INTO store_settings (key, value) VALUES ('openai_api_key', 'sk-...')
ON CONFLICT (key) DO UPDATE SET value = excluded.value;
```

Leave it unset and the AI features degrade to "unavailable" rather than
erroring — nothing else breaks.

**Authentication emails** — password resets and email confirmations go through
`process-email-queue` / `auth-email-hook`, which use the provider's email
library. Business email (orders, newsletter, alerts) already goes through
Resend and is unaffected.

The replacement is better than what it replaces: Authentication → Emails →
**SMTP Settings**, point it at Resend (`smtp.resend.com`, port 465, user
`resend`, password = your Resend API key). Supabase then sends auth emails
itself and the two provider-coupled functions become dead weight you can
delete.

---

## 6. Copy the product images  *(script)*

Storage objects are files, not rows, so the database migration does not touch
them.

```bash
npx supabase storage cp -r \
  ss://product-images ./product-images-backup --experimental \
  --project-ref xwiqubcilptxzvdigsmp

npx supabase storage cp -r \
  ./product-images-backup ss://product-images --experimental \
  --project-ref okejdzkftwhccplyfluf
```

Create the `product-images` bucket on the new project first (public, same as
the old one).

---

## 7. Point the front end at the new project  *(code)*

One file: `src/integrations/supabase/client.ts`, plus `supabase/config.toml`'s
`project_id`. Deploy, click through the site on the preview URL, and confirm:
products load, sign-in works, a test add-to-cart survives a refresh.

Do this while the old project is still live. If anything is wrong, you revert
one commit and nothing happened.

---

## 8. Cut over  *(the only irreversible step)*

Point `aismartstore.co.za` at the new deployment and update the Yoco webhook
URL to the new project. Everything before this was reversible; this is not,
because payment webhooks that arrive at the old project during the gap are
gone.

Do it at a quiet hour. Then:

- place a R1 test order end to end and confirm `payment_events` gets a row
- confirm the Axiz sync runs on its next 15-minute tick (`sync_logs`)
- confirm the AI Pulse digest drafts overnight

---

## Verifying it worked

```sql
-- 51, matching the old project exactly
select count(*) from information_schema.tables
 where table_schema='public' and table_type='BASE TABLE';

-- 90
select count(*) from pg_policies where schemaname='public';

-- every job pointing at the NEW project, via one setting
select value from store_settings where key='functions_base_url';
select jobname, schedule from cron.job order by jobname;
```

The last one matters. Before the `portable_edge_invocation` migration, thirteen
scheduled jobs each had this project's URL baked into them and would have gone
on firing happily against a dead project, queueing requests, recording no
error. Now they all read one row, and the migration script sets it.

---

## What this does not cover

- **Analytics history.** Page-view data lives with the old host and does not
  move. 184 visitors / 564 pageviews since 9 July is the number worth writing
  down before it goes.
- **Old inactive products**, if you took the default. Recoverable by running
  the Axiz sync with the gates relaxed; not worth the 400MB otherwise.
