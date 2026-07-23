// AI Smart Store -- uptime & security-header monitor
//
// Runs on a schedule (every 10 min) AND can be hit directly at /status.
// Checks:
//   1. Is the site up at all (HTTP status)?
//   2. Does it show the known "permission denied" / broken-products
//      signature that caused the June 27 outage? (regression guard)
//   3. Are basic security headers present?
// Results are written to KV so /status always returns the latest check
// without re-fetching the site on every visitor request.

export interface Env {
  HEALTH_KV: KVNamespace;
}

const SITE_URL = "https://aismartstore.co.za";
const HISTORY_KEY = "health-history";
const MAX_HISTORY = 50;

interface HealthCheck {
  timestamp: string;
  status: "healthy" | "degraded" | "down";
  httpStatus: number | null;
  checks: {
    siteReachable: boolean;
    noPermissionErrors: boolean;
    securityHeadersPresent: boolean;
  };
  notes: string[];
}

async function runHealthCheck(): Promise<HealthCheck> {
  const notes: string[] = [];
  let httpStatus: number | null = null;
  let siteReachable = false;
  let noPermissionErrors = true;
  let securityHeadersPresent = true;

  try {
    const res = await fetch(SITE_URL, { redirect: "follow" });
    httpStatus = res.status;
    siteReachable = res.ok;

    const body = await res.text();
    if (body.includes("permission denied for table") || body.includes("Error loading products")) {
      noPermissionErrors = false;
      notes.push("Detected the known RLS/permission-error signature -- products may be failing to load.");
    }
    if (body.includes("files are missing")) {
      noPermissionErrors = false;
      notes.push("Detected the 'published but files are missing' hosting signature -- may need a re-publish.");
    }

    // Basic security header sanity (the hosting platform manages most of
    // this, but worth tracking in case the config ever regresses)
    const csp = res.headers.get("content-security-policy");
    const xfo = res.headers.get("x-frame-options");
    if (!csp && !xfo) {
      securityHeadersPresent = false;
      notes.push("No CSP or X-Frame-Options header detected.");
    }
  } catch (e) {
    notes.push(`Fetch failed: ${(e as Error).message}`);
  }

  const status: HealthCheck["status"] =
    !siteReachable ? "down" : !noPermissionErrors ? "degraded" : "healthy";

  return {
    timestamp: new Date().toISOString(),
    status,
    httpStatus,
    checks: { siteReachable, noPermissionErrors, securityHeadersPresent },
    notes,
  };
}

async function recordCheck(env: Env, check: HealthCheck) {
  const existing = await env.HEALTH_KV.get(HISTORY_KEY);
  const history: HealthCheck[] = existing ? JSON.parse(existing) : [];
  history.unshift(check);
  await env.HEALTH_KV.put(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env) {
    const check = await runHealthCheck();
    await recordCheck(env, check);
    // To add alerting (email/Slack/Telegram on status !== "healthy"),
    // add a fetch() call to your chosen webhook here once you've
    // decided where alerts should go.
  },

  async fetch(req: Request, env: Env) {
    const url = new URL(req.url);

    if (url.pathname === "/status") {
      const existing = await env.HEALTH_KV.get(HISTORY_KEY);
      const history: HealthCheck[] = existing ? JSON.parse(existing) : [];
      const latest = history[0] || null;
      return new Response(JSON.stringify({ latest, history }, null, 2), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    if (url.pathname === "/check-now") {
      const check = await runHealthCheck();
      await recordCheck(env, check);
      return new Response(JSON.stringify(check, null, 2), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("AI Smart Store uptime monitor. See /status or /check-now.", { status: 200 });
  },
};
