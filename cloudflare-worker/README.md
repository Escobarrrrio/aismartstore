# AI Smart Store -- Uptime & Security Monitor (Cloudflare Worker)

A standalone Cloudflare Worker that checks the live site every 10 minutes
and exposes a `/status` endpoint. Independent of Lovable/Supabase --
this is a separate, external watchdog.

## Deploy (one-time, ~3 minutes)

You need Node.js installed locally for this (same requirement as the
main app). Claude cannot deploy this directly -- the Cloudflare MCP
connection only has read access to your account, not deploy permission.

```bash
npm install -g wrangler
wrangler login                          # opens a browser, one click
cd cloudflare-worker
wrangler kv namespace create HEALTH_KV  # copy the "id" it prints
# paste that id into wrangler.toml, replacing REPLACE_WITH_KV_NAMESPACE_ID
wrangler deploy
```

That's it. Wrangler prints a `*.workers.dev` URL -- that's your monitor.

## Using it

- `https://<your-worker>.workers.dev/status` -- last 50 health checks (JSON)
- `https://<your-worker>.workers.dev/check-now` -- force an immediate check

## Adding alerts (optional next step)

Right now it just records history to KV. To get pinged when something's
actually wrong, tell Claude where to send alerts (email, Slack, Telegram,
a webhook) and it'll wire a notification call into the `scheduled()`
function -- the hook is already marked in the code with a comment.
