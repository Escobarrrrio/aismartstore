import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const SESSION_KEY = "ai-smart-store.analytics-session";
const CONSENT_KEY = "ai-smart-store.cookie-consent";

/**
 * First-party pageview beacon. Fires once per route change, after route
 * change (not blocking navigation), and only once the visitor has accepted
 * the cookie-consent banner -- the same gate CookieConsentBanner.tsx uses
 * for the (currently no-op) Google Consent Mode signal, so first-party
 * analytics get treated exactly as seriously as third-party would be.
 *
 * The session id is a random UUID held in localStorage, not a cookie, and
 * never sent anywhere but our own Supabase project. It identifies a browser
 * across pageviews for "distinct visitors" counting -- nothing more. It is
 * regenerated if the browser has never accepted consent, so declining
 * tracking (or clearing storage) genuinely starts a fresh, unlinkable id
 * rather than silently keeping the old one.
 */
function getOrCreateSessionId(): string {
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

/** "https://www.google.com/search?q=..." -> "google.com". Empty referrer
 *  (typed URL, bookmark, or a browser that strips it) reads as "direct",
 *  matching how every analytics tool bucket this. */
function bucketSource(referrer: string): string {
  if (!referrer) return "direct";
  try {
    const host = new URL(referrer).hostname.replace(/^www\./, "");
    // Our own domain as a referrer means an internal navigation, e.g. a
    // full page reload from a link on the site -- that is not an
    // acquisition source and would otherwise dominate the chart.
    if (host === "aismartstore.co.za") return "direct";
    return host;
  } catch {
    return "direct";
  }
}

function currentDeviceType(): "mobile" | "tablet" | "desktop" {
  const w = window.innerWidth;
  if (w < 640) return "mobile";
  if (w < 1024) return "tablet";
  return "desktop";
}

export function usePageViewTracking() {
  const location = useLocation();

  useEffect(() => {
    if (localStorage.getItem(CONSENT_KEY) !== "accepted") return;

    const payload = {
      path: location.pathname,
      source: bucketSource(document.referrer),
      device_type: currentDeviceType(),
      session_id: getOrCreateSessionId(),
    };

    // Fire-and-forget: a pageview beacon must never be able to slow down or
    // fail a real navigation. Errors are swallowed deliberately -- there is
    // nothing a shopper-facing page could do about a dropped analytics call.
    //
    // Same-origin `/api/track` (a Vercel Edge Function), not the Supabase
    // client directly: it already sees Vercel's free `x-vercel-ip-country`/
    // `x-vercel-ip-city` headers and forwards real geo to `track-pageview`,
    // instead of that function having to guess from a third-party IP
    // lookup that showed up as "Unknown" more often than not.
    fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {});
    // Only the path should re-fire this -- referrer/device are read fresh
    // each time but aren't reactive dependencies in their own right.
  }, [location.pathname]);
}
