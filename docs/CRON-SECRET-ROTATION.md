# Rotating the internal cron secret (zero downtime)

Scheduled jobs (`axiz-sync`, `sync-ai-pulse`, `sync-exchange-rates`,
`stock-sanity-check`, `sync-courier-tracking`, `cleanup-blocked-products`,
`engine-room-analyst`, …) call their edge functions with an
`x-internal-secret` header. That header is what stops anyone on the internet
from triggering distributor syncs, third-party feed fetches or e-mail batches
from our egress IP.

## How it stays online during a rotation

1. **Schedules read the secret at call time.** Every `pg_cron` job builds its
   headers from `vault.decrypted_secrets` where `name = 'internal_cron_secret'`.
   Changing that vault value is instantly picked up — no job command is
   rewritten, so there is no window where a schedule holds a stale literal.
2. **Edge functions accept more than one version.** `_shared/cron-secret.ts`
   validates the presented secret against
   `public.verify_internal_cron_secret()`, which accepts the **active** version
   and any **retiring** version whose grace window has not expired. The
   `INTERNAL_CRON_SECRET` env var still works as a fallback.
3. **Only hashes are stored.** `public.internal_cron_secret_versions` keeps a
   SHA-256 hash and a short fingerprint per version — never the plaintext.

## Rotating from the admin UI

Admin → **Security** → *Internal cron secret*:

1. Set the grace window (default 60 minutes; allowed 5–1440).
2. Click **Rotate now**. The new secret is minted, written to the vault, and
   shown **once**.
3. Copy it and paste it into the `INTERNAL_CRON_SECRET` function secret if you
   want the env fallback to match the new value. This is optional — the
   database verifier already accepts the new secret.
4. Watch Admin → *Edge Function Health*. Once a scheduled run has succeeded on
   the new key, click **Close grace window** to retire the old key immediately.
   If you do nothing, a 10-minute clean-up job (`finalize-cron-secret-rotation`)
   retires it automatically when the window expires.

## Rotating from SQL (break-glass)

```sql
-- returns new_secret, fingerprint, grace_until
SELECT * FROM public.rotate_internal_cron_secret(60, NULL, 'break-glass rotation');

-- close the overlap early
SELECT public.finalize_internal_cron_secret_rotation();
```

Both functions are `SECURITY DEFINER` and executable by `service_role` only.

## When to rotate

- Immediately if the secret was pasted into a ticket, chat, screenshot or log.
- When someone with backend access leaves.
- Routinely every 90 days.

## Verifying afterwards

```bash
# must be 403
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  https://<project>.supabase.co/functions/v1/sync-exchange-rates

# must be 403 with a wrong secret
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  -H 'x-internal-secret: definitely-not-it' \
  https://<project>.supabase.co/functions/v1/sync-exchange-rates
```

The Playwright spec `e2e/sync-endpoint-auth.spec.ts` asserts exactly this for
both sync endpoints, and — when `PLAYWRIGHT_INTERNAL_CRON_SECRET` is provided —
also asserts that the intended secret path succeeds.
