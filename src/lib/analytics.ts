/**
 * Lightweight, dependency-free analytics dispatcher.
 *
 * - Pushes to `window.dataLayer` when GTM/GA4 is present.
 * - Also dispatches a `CustomEvent("analytics", { detail })` on `window`
 *   so E2E tests and custom listeners can observe events without needing
 *   a real analytics backend.
 * - No-op in non-browser contexts (SSR, tests without jsdom window).
 *
 * Add a listener in the browser console while debugging:
 *   window.addEventListener("analytics", (e) => console.log(e.detail));
 */

/**
 * Which slice of the catalogue an event refers to. "all" is the combined
 * Home + Business view offered by the scope control on /products.
 */
export type StorefrontAudience = "residential" | "business" | "all";

export type AnalyticsEvent =
  | { name: "facet_selected"; facet: "category" | "brand"; value: string; page: string }
  | { name: "facet_cleared"; facet: "category" | "brand" | "ai" | "stock" | "business" | "min_price" | "max_price" | "search"; value?: string; page: string }
  | { name: "active_filter_chip_dismissed"; key: string; label: string; page: string }
  | { name: "sort_changed"; value: string; page: string }
  | { name: "page_changed"; value: number; page: string }
  | { name: "filters_cleared_all"; page: string }
  // Catalogue scope switch on /products ("Home" / "Business" / "Everything").
  | { name: "audience_changed"; value: StorefrontAudience; page: string }
  // Storefront audience telemetry — proves the residential/business split in prod.
  | { name: "storefront_viewed"; audience: StorefrontAudience; surface: "home" | "products" | "procurement" | "header_search"; query?: string }
  | { name: "product_list_returned"; audience: StorefrontAudience; surface: "home" | "products" | "procurement" | "header_search"; count: number; total?: number; query?: string }
  | { name: "audience_guard_blocked"; allow: "residential" | "business"; actual: "residential" | "business" | "anonymous" }
  | { name: "business_upgrade_requested" };

type AnyRecord = Record<string, unknown>;

declare global {
  interface Window {
    // unknown[] rather than AnyRecord[]: most pushes here are plain event
    // objects, but CookieConsentBanner.tsx also pushes gtag.js-style
    // ["consent", command, params] tuples for Google Consent Mode v2 --
    // both need to fit the same global dataLayer type.
    dataLayer?: unknown[];
  }
}

export function trackEvent(event: AnalyticsEvent): void {
  if (typeof window === "undefined") return;
  try {
    const payload: AnyRecord = { ...event, ts: Date.now() };
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event: event.name, ...payload });
    window.dispatchEvent(new CustomEvent("analytics", { detail: payload }));
  } catch {
    // Never let analytics break UX.
  }
}
