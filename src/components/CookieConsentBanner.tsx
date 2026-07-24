import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Cookie } from "lucide-react";

// The chat widget's launcher FAB is also fixed to the bottom-right corner
// (see ChatWidget.tsx) -- without this, the banner (full-width, pinned to
// the very bottom, same z-index) renders on top of it and silently
// swallows every click on the launcher until the visitor deals with the
// banner. Publishing the banner's real rendered height as a CSS variable
// lets the widget push itself up by exactly that much, staying correct
// across the banner's mobile (stacked) vs desktop (single-row) layouts
// without either component needing to know about the other's internals.
export const COOKIE_BANNER_HEIGHT_VAR = "--cookie-banner-h";

const STORAGE_KEY = "ai-smart-store.cookie-consent";
type Choice = "accepted" | "rejected";

/**
 * Pushes a Google Consent Mode v2 signal to window.dataLayer in the exact
 * shape gtag.js expects (dataLayer.push(["consent", command, params])).
 * No GTM/gtag.js script is loaded on this site yet (see CookiePolicy.tsx),
 * so this is currently a no-op as far as any live tag is concerned -- but
 * it means a GA4/Ads tag can be added later and immediately respect
 * whatever the visitor already chose, without a second consent rollout.
 */
function pushConsentSignal(command: "default" | "update", granted: boolean) {
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push([
    "consent",
    command,
    {
      analytics_storage: granted ? "granted" : "denied",
      ad_storage: granted ? "granted" : "denied",
      ad_user_data: granted ? "granted" : "denied",
      ad_personalization: granted ? "granted" : "denied",
    },
  ]);
}

const CookieConsentBanner = () => {
  const [visible, setVisible] = useState(false);
  const bannerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = document.documentElement;
    if (!visible) {
      root.style.setProperty(COOKIE_BANNER_HEIGHT_VAR, "0px");
      return;
    }
    const el = bannerRef.current;
    if (!el) return;
    const update = () => root.style.setProperty(COOKIE_BANNER_HEIGHT_VAR, `${el.offsetHeight}px`);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
      root.style.setProperty(COOKIE_BANNER_HEIGHT_VAR, "0px");
    };
  }, [visible]);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Choice | null;
    if (stored === "accepted" || stored === "rejected") {
      pushConsentSignal("default", stored === "accepted");
      return;
    }
    // No choice recorded yet -- default to denied (POPIA's opt-in norm)
    // until the visitor actively accepts, and show the banner.
    pushConsentSignal("default", false);
    setVisible(true);
  }, []);

  const choose = (choice: Choice) => {
    localStorage.setItem(STORAGE_KEY, choice);
    pushConsentSignal("update", choice === "accepted");
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      ref={bannerRef}
      role="region"
      aria-label="Cookie consent"
      className="fixed bottom-0 inset-x-0 z-50 border-t border-border bg-card shadow-elevated"
    >
      <div className="container mx-auto px-4 py-4 flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <div className="flex items-start gap-3 flex-1">
          <Cookie className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground leading-relaxed">
            We use essential local storage to keep you signed in and remember your preferences, and first-party
            analytics to understand how the store is used. See our{" "}
            <Link to="/cookies" className="text-primary underline">Cookie Policy</Link> for exactly what that means.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 w-full sm:w-auto">
          <button
            type="button"
            onClick={() => choose("rejected")}
            className="btn-secondary px-4 py-2 text-xs flex-1 sm:flex-none"
          >
            Reject non-essential
          </button>
          <button
            type="button"
            onClick={() => choose("accepted")}
            className="btn-primary px-4 py-2 text-xs flex-1 sm:flex-none"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
};

export default CookieConsentBanner;
