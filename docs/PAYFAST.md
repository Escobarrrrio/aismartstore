# PayFast (Capitec Pay) integration

Payments flow to the Capitec business account via PayFast. This document covers
the environment switch, the ITN (webhook) guarantees, and how to troubleshoot a
payment that didn't land.

## Switching live ↔ sandbox

**One secret. No code change, no redeploy of application logic.**

| `PAYFAST_SANDBOX` | Checkout posts to | Webhook validates against | IP allow-list |
|---|---|---|---|
| `true` | `sandbox.payfast.co.za` | `sandbox.payfast.co.za` | relaxed |
| unset / anything else | `www.payfast.co.za` (**LIVE**) | `www.payfast.co.za` | enforced |

Set it in **Supabase → Project Settings → Edge Functions → Secrets**.

Both `create-payfast-checkout` and `payfast-webhook` read this through
`supabase/functions/_shared/payfast-env.ts`. That shared module is the reason the
two can't drift: if checkout sent a shopper to sandbox while the webhook
validated against live, every ITN would fail validation and orders would sit
unpaid despite the customer being charged.

Only the exact string `true` (case-insensitive, whitespace-trimmed) enables
sandbox. Anything ambiguous — `1`, `yes`, `TRUE_`, a typo — resolves to **live**.
This is deliberate: the failure mode of accidentally running live is a real,
verified payment; the failure mode of accidentally running sandbox is money that
is never actually collected. Covered by `_shared/payfast-env.test.ts`.

Sandbox uses different merchant credentials, so change `PAYFAST_MERCHANT_ID` and
`PAYFAST_MERCHANT_KEY` together with the flag.

### Secrets

| Secret | Required | Notes |
|---|---|---|
| `PAYFAST_MERCHANT_ID` | yes | Per environment |
| `PAYFAST_MERCHANT_KEY` | yes | Per environment |
| `PAYFAST_PASSPHRASE` | only if set in the PayFast dashboard | Must match exactly, or **every** ITN fails signature |
| `PAYFAST_SANDBOX` | no | Absent = live |
| `SLACK_ALERT_WEBHOOK_URL` | no | Adds Slack to webhook alerts |

## Notify URL

The webhook lives at:

```
https://<project>.supabase.co/functions/v1/payfast-webhook
```

That URL does **not** need to fit the Notify URL field in the PayFast dashboard.
`create-payfast-checkout` sends `notify_url` on every transaction, and a
per-transaction value overrides the dashboard setting. Put any valid URL
(e.g. `https://aismartstore.co.za`) in the dashboard field to satisfy its
validation.

## Exactly-once guarantee

PayFast retries an ITN until it gets a `200`, and legitimately delivers the same
notification more than once. Without a guard, each delivery would re-run the
order update and re-send the customer confirmation.

Idempotency is enforced by the **database**, not by the function remembering
anything:

```sql
CREATE UNIQUE INDEX idx_payment_events_idempotency
  ON payment_events (provider, provider_payment_id, payment_status)
  WHERE outcome = 'processed' AND provider_payment_id IS NOT NULL;
```

`record_payment_event(...)` inserts with `ON CONFLICT DO NOTHING` and returns
`is_first`. Only the caller that wins the claim updates the order and invokes
`notify-order`. Concurrent duplicate deliveries race for the same row; the loser
is recorded as `duplicate_ignored` and returns `200` without side effects.

Rejections are recorded with a **non-`processed`** outcome, so a failed attempt
never consumes the idempotency slot — a genuine retry after a transient fault can
still succeed.

### Order creation

The webhook only ever **updates** orders. Orders are created at checkout, before
the shopper is redirected. A webhook that could create orders would let anyone
who can reach the endpoint mint them.

## What gets alerted

`_shared/webhook-alerts.ts` alerts on the **first** occurrence (deduped per
kind for 15 minutes) — unlike the streak-based alerting used for cron jobs,
because one bad signature is already one too many.

| Kind | Outcome | Meaning |
|---|---|---|
| `ip_rejected` | `rejected_ip` | Callback from outside PayFast's IP ranges |
| `signature_invalid` | `rejected_signature` | Signature mismatch — often a changed passphrase |
| `server_validation_failed` | `rejected_validation` | PayFast didn't confirm it; usually a live/sandbox mismatch |
| `amount_mismatch` | `amount_mismatch` | Paid amount ≠ order total. Order is **not** marked paid |
| `unknown_order` | `unknown_order` | Verified ITN with no order id in `custom_str1` |
| `handler_error` | `error` | Unhandled exception, or the confirmation email failed |

Alerts go to `store_settings.notification_email` (and Slack if configured).

## Troubleshooting

**Admin → Payment Events.** Every callback is there — verified or not — with the
raw ITN payload, signature/IP result, amounts, outcome, and whether the
confirmation email was sent. Filter to *Needs attention*.

Useful queries:

```sql
-- Anything that didn't complete cleanly, most recent first
SELECT created_at, outcome, payment_status, provider_payment_id, order_id, error_message
FROM payment_events
WHERE outcome <> 'processed'
ORDER BY created_at DESC LIMIT 50;

-- Payments recorded but whose confirmation email never went out
SELECT order_id, provider_payment_id, created_at, error_message
FROM payment_events
WHERE outcome = 'processed' AND NOT notified;

-- Prove exactly-once for one transaction
SELECT outcome, count(*) FROM payment_events
WHERE provider_payment_id = '<pf_payment_id>' GROUP BY outcome;
```

A healthy retried payment reads: one `processed`, N `duplicate_ignored`.

### Common causes

| Symptom | Cause |
|---|---|
| All ITNs `rejected_signature` | `PAYFAST_PASSPHRASE` doesn't match the dashboard, or "require signature" was toggled |
| All ITNs `rejected_validation` | Checkout and webhook on different environments, or merchant credentials from the other one |
| All ITNs `rejected_ip` | Traffic isn't from PayFast, or you're testing sandbox with `PAYFAST_SANDBOX` unset |
| Paid but no email | `RESEND_API_KEY` missing/invalid — look for `notified = false` |
