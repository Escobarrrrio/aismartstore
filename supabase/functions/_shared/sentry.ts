// Lightweight Sentry envelope reporter for edge functions.
// Uses SENTRY_DSN env var; falls back to console.error when not configured.
// This avoids pulling the full Sentry SDK into every function.

interface CaptureOptions {
  level?: "error" | "warning" | "info";
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  fingerprint?: string[];
}

function parseDsn(dsn: string) {
  // https://<publicKey>@<host>/<projectId>
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.replace(/^\//, "");
    const publicKey = url.username;
    if (!projectId || !publicKey) return null;
    return {
      publicKey,
      host: url.host,
      projectId,
      envelopeUrl: `${url.protocol}//${url.host}/api/${projectId}/envelope/`,
    };
  } catch {
    return null;
  }
}

export async function captureEdgeError(
  message: string,
  err: unknown,
  opts: CaptureOptions = {},
) {
  const dsn = Deno.env.get("SENTRY_DSN");
  const errObj = err instanceof Error ? err : new Error(String(err ?? message));
  const payload = {
    level: opts.level ?? "error",
    logger: "edge-function",
    platform: "javascript",
    timestamp: Date.now() / 1000,
    message,
    tags: opts.tags,
    extra: opts.extra,
    fingerprint: opts.fingerprint,
    exception: {
      values: [
        {
          type: errObj.name,
          value: errObj.message,
          stacktrace: errObj.stack ? { frames: [{ filename: "edge", function: errObj.stack.split("\n")[0] }] } : undefined,
        },
      ],
    },
  };

  // Always emit structured console log for Supabase log ingestion.
  console.error(`[sentry:${opts.level ?? "error"}]`, JSON.stringify({ message, tags: opts.tags, extra: opts.extra, err: errObj.message }));

  if (!dsn) return { ok: false, reason: "no_dsn" };
  const parsed = parseDsn(dsn);
  if (!parsed) return { ok: false, reason: "invalid_dsn" };

  const eventId = crypto.randomUUID().replace(/-/g, "");
  const header = { event_id: eventId, sent_at: new Date().toISOString(), dsn };
  const itemHeader = { type: "event" };
  const body =
    JSON.stringify(header) + "\n" +
    JSON.stringify(itemHeader) + "\n" +
    JSON.stringify({ ...payload, event_id: eventId });

  try {
    const res = await fetch(parsed.envelopeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${parsed.publicKey}, sentry_client=lovable-edge/1.0`,
      },
      body,
    });
    await res.text();
    return { ok: res.ok, status: res.status, eventId };
  } catch (e) {
    console.error("[sentry] envelope post failed:", (e as Error).message);
    return { ok: false, reason: "post_failed" };
  }
}
