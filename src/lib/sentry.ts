// Sentry error tracking, loaded off the critical path.
//
// Sentry used to be a static import in main.tsx, which put the whole SDK --
// browser tracing and Session Replay included, and Replay is the expensive one
// -- into the bundle every visitor downloads before the first pixel appears.
// A storefront on South African mobile data paid for a diagnostic tool on
// every first visit, before seeing a single product.
//
// It is now imported dynamically once the browser is idle. The trade is
// explicit: errors thrown in the first moment of a session are not captured
// live. In exchange the shop renders sooner for everyone. The first screen is
// a product grid, not a payment form, so that is the right way round.
//
// Errors raised *before* the SDK arrives are not lost -- they queue and flush
// once it is ready, so the checkout and payment helpers behave the same
// whether or not loading has finished.

type SentryModule = typeof import("@sentry/react");
type Flow = "checkout" | "payment" | "order_placement";

const DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;
const ENV = (import.meta.env.MODE as string) || "production";

let sentry: SentryModule | null = null;
let loading: Promise<SentryModule | null> | null = null;

/** Events raised before the SDK finished loading. Bounded, so a page throwing
 *  in a loop cannot grow this without limit. */
const pending: Array<{ flow: Flow; error: unknown; context?: Record<string, unknown> }> = [];
const MAX_PENDING = 20;

function send(mod: SentryModule, flow: Flow, error: unknown, context?: Record<string, unknown>) {
  mod.withScope((scope) => {
    scope.setTag("flow", flow);
    if (context) scope.setContext("details", context);
    scope.setLevel("error");
    mod.captureException(error instanceof Error ? error : new Error(String(error)));
  });
}

async function load(): Promise<SentryModule | null> {
  if (sentry) return sentry;
  if (!DSN) return null;
  if (loading) return loading;

  loading = import("@sentry/react")
    .then((mod) => {
      mod.init({
        dsn: DSN,
        environment: ENV,
        tracesSampleRate: 0.1,
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 1.0,
        integrations: [mod.browserTracingIntegration(), mod.replayIntegration()],
        // Filter noise: cancelled network requests during navigation, extension errors.
        ignoreErrors: [
          "ResizeObserver loop limit exceeded",
          "Non-Error promise rejection captured",
          /Failed to fetch/i,
        ],
      });
      sentry = mod;
      const queued = pending.splice(0, pending.length);
      for (const item of queued) send(mod, item.flow, item.error, item.context);
      return mod;
    })
    .catch((err) => {
      // A blocked or failed SDK load must never take the storefront with it.
      console.warn("[sentry] could not load", err);
      return null;
    });

  return loading;
}

/**
 * Schedules the SDK for when the browser has nothing better to do.
 *
 * `requestIdleCallback` where available, a timeout elsewhere (Safari). Either
 * way it is after first paint, which is the entire point.
 */
export function initSentry() {
  if (!DSN || typeof window === "undefined") return;
  const start = () => { void load(); };
  // Narrowed via a local alias rather than `window as ... ` inline: the inline
  // cast made TypeScript treat the else-branch `window` as `never`.
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void;
  };
  if (typeof w.requestIdleCallback === "function") {
    w.requestIdleCallback(start, { timeout: 4000 });
  } else {
    w.setTimeout(start, 2000);
  }
}

function capture(flow: Flow, error: unknown, context?: Record<string, unknown>) {
  if (!DSN) {
    console.warn(`[sentry:${flow}]`, error, context);
    return;
  }
  if (sentry) {
    send(sentry, flow, error, context);
    return;
  }
  // Not loaded yet. Queue and start loading -- a checkout error is exactly the
  // thing that must not be dropped because a diagnostic tool was still
  // downloading.
  if (pending.length < MAX_PENDING) pending.push({ flow, error, context });
  void load();
}

export const captureCheckoutError = (e: unknown, ctx?: Record<string, unknown>) =>
  capture("checkout", e, ctx);
export const capturePaymentError = (e: unknown, ctx?: Record<string, unknown>) =>
  capture("payment", e, ctx);
export const captureOrderError = (e: unknown, ctx?: Record<string, unknown>) =>
  capture("order_placement", e, ctx);
