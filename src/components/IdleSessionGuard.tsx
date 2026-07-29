import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { ShieldAlert } from "lucide-react";

/**
 * Signs a shopper out after a period of no interaction.
 *
 * Supabase sessions refresh themselves indefinitely, so without this a customer
 * who signs in on a shared or public machine stays authenticated more or less
 * forever — their saved addresses, order history and checkout are one tab-restore
 * away for whoever sits down next.
 *
 * Design notes:
 *
 * - Idle time is tracked as a **timestamp in localStorage**, not a running timer.
 *   A background tab gets its timers throttled by the browser, and a laptop that
 *   sleeps for two hours would otherwise wake up believing it had been idle for
 *   seconds. Comparing wall-clock stamps is immune to both.
 * - localStorage also makes it work across tabs: activity in any tab refreshes
 *   the stamp for all of them, so a shopper reading one tab isn't logged out by
 *   another sitting idle.
 * - A warning appears before the deadline. Silently destroying a session
 *   mid-checkout would look like the site broke.
 */

const STORAGE_KEY = "aismartstore.lastActivityAt";

/** 30 minutes of no interaction ends the session. */
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
/** Warn for the last 2 minutes of that window. */
export const IDLE_WARNING_MS = 2 * 60 * 1000;
/** How often the deadline is evaluated. */
const CHECK_INTERVAL_MS = 15 * 1000;

/** Interaction that counts as "still here". Passive so scrolling stays smooth. */
const ACTIVITY_EVENTS: Array<keyof WindowEventMap> = [
  "pointerdown", "keydown", "wheel", "touchstart", "focus",
];

const IdleSessionGuard = () => {
  const { t } = useTranslation();
  const [signedIn, setSignedIn] = useState(false);
  const [msLeft, setMsLeft] = useState<number | null>(null);
  const signedInRef = useRef(false);

  const markActive = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(Date.now()));
    } catch {
      // Private-browsing modes can refuse writes; fall through to the
      // in-memory read path rather than breaking the page.
    }
    setMsLeft(null);
  }, []);

  const readLastActive = useCallback((): number => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? Number(raw) : NaN;
      // A missing or corrupt stamp must not read as "idle since 1970" and log
      // the shopper straight out.
      if (!Number.isFinite(parsed) || parsed <= 0 || parsed > Date.now() + 60_000) {
        return Date.now();
      }
      return parsed;
    } catch {
      return Date.now();
    }
  }, []);

  // Track auth state; the guard is inert for anonymous visitors.
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      const active = !!data.session;
      signedInRef.current = active;
      setSignedIn(active);
      if (active) markActive();
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      const active = !!session;
      signedInRef.current = active;
      setSignedIn(active);
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") markActive();
      if (event === "SIGNED_OUT") setMsLeft(null);
    });

    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, [markActive]);

  // Record activity.
  useEffect(() => {
    if (!signedIn) return;
    const onActivity = () => markActive();
    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, onActivity, { passive: true });
    }
    // Returning to a tab counts as activity, but only when the tab becomes
    // visible — not when it is hidden, or a background tab would keep itself
    // alive forever.
    const onVisibility = () => { if (document.visibilityState === "visible") markActive(); };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, onActivity);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [signedIn, markActive]);

  // Enforce the deadline.
  useEffect(() => {
    if (!signedIn) return;

    const tick = async () => {
      if (!signedInRef.current) return;
      const idleFor = Date.now() - readLastActive();
      const remaining = IDLE_TIMEOUT_MS - idleFor;

      if (remaining <= 0) {
        setMsLeft(null);
        try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
        await supabase.auth.signOut();
        return;
      }
      setMsLeft(remaining <= IDLE_WARNING_MS ? remaining : null);
    };

    const id = window.setInterval(tick, CHECK_INTERVAL_MS);
    void tick();
    return () => window.clearInterval(id);
  }, [signedIn, readLastActive]);

  if (!signedIn || msLeft === null) return null;

  const seconds = Math.max(0, Math.ceil(msLeft / 1000));

  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      aria-label={t("session.idleTitle")}
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[90] w-[min(92vw,26rem)] rounded-xl border border-amber-300 bg-amber-50 p-4 shadow-lg"
    >
      <div className="flex items-start gap-3">
        <ShieldAlert className="h-5 w-5 shrink-0 text-amber-700 mt-0.5" aria-hidden="true" />
        <div className="flex-1">
          <p className="font-display font-semibold text-sm text-amber-900">{t("session.idleTitle")}</p>
          <p className="mt-1 text-xs text-amber-900/80">
            {t("session.idleBody", { seconds })}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={markActive}
        className="mt-3 w-full rounded-lg bg-amber-900 px-4 py-2 text-sm font-semibold text-amber-50 hover:bg-amber-800"
      >
        {t("session.staySignedIn")}
      </button>
    </div>
  );
};

export default IdleSessionGuard;
