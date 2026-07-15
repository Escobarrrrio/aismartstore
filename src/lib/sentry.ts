// Sentry error tracking wrapper.
// Initialise once at boot; every call site (`captureCheckoutError`,
// `capturePaymentError`, `captureOrderError`) is a thin tag helper so a
// missing DSN degrades to console warnings without breaking the flow.
import * as Sentry from "@sentry/react";

const DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;
const ENV = (import.meta.env.MODE as string) || "production";

let initialized = false;

export function initSentry() {
  if (initialized || !DSN) return;
  Sentry.init({
    dsn: DSN,
    environment: ENV,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
    integrations: [Sentry.browserTracingIntegration(), Sentry.replayIntegration()],
    // Filter noise: cancelled network requests during navigation, extension errors.
    ignoreErrors: [
      "ResizeObserver loop limit exceeded",
      "Non-Error promise rejection captured",
      /Failed to fetch/i,
    ],
  });
  initialized = true;
}

type Flow = "checkout" | "payment" | "order_placement";

function capture(flow: Flow, error: unknown, context?: Record<string, unknown>) {
  if (!DSN) {
    console.warn(`[sentry:${flow}]`, error, context);
    return;
  }
  Sentry.withScope((scope) => {
    scope.setTag("flow", flow);
    if (context) scope.setContext("details", context as Record<string, unknown>);
    scope.setLevel("error");
    Sentry.captureException(error instanceof Error ? error : new Error(String(error)));
  });
}

export const captureCheckoutError = (e: unknown, ctx?: Record<string, unknown>) =>
  capture("checkout", e, ctx);
export const capturePaymentError = (e: unknown, ctx?: Record<string, unknown>) =>
  capture("payment", e, ctx);
export const captureOrderError = (e: unknown, ctx?: Record<string, unknown>) =>
  capture("order_placement", e, ctx);

export { Sentry };
