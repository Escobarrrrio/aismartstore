import { useEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";
import { canRestore, clampOffset, recall, remember, shouldKeepTrying, RESTORE_TIMEOUT_MS } from "@/lib/scrollMemory";

/**
 * Scroll position across navigation.
 *
 * Forward to a new page: top, as expected. Back or forward through history:
 * exactly where you were.
 *
 * The browser has native restoration for this and it does not work in a
 * single-page app -- going back renders an empty grid and fetches the products
 * afterwards, so at the instant the browser tries to scroll to 4,200px the
 * document is 900px tall and the offset is clamped away to nothing. Native
 * restoration is therefore switched off and done here instead, retrying each
 * frame until the page is genuinely tall enough to hold the position.
 *
 * Hash links are left alone -- that is the browser's job and it does it well.
 */
const ScrollToTop = () => {
  const { pathname, search, hash, key } = useLocation();
  const navType = useNavigationType();
  const frame = useRef<number>();

  // Record continuously rather than on unmount: React may unmount this subtree
  // after the URL has already changed, at which point window.scrollY is the
  // *new* page's offset and we would file it against the old page's key.
  useEffect(() => {
    const onScroll = () => remember(key, window.scrollY);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      // One final read, so a click made without scrolling since the last event
      // still records the position it happened at.
      remember(key, window.scrollY);
      window.removeEventListener("scroll", onScroll);
    };
  }, [key]);

  useEffect(() => {
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
  }, []);

  useEffect(() => {
    if (frame.current) cancelAnimationFrame(frame.current);

    // Anchor links: the browser is better at this than we are.
    if (hash) return;

    if (navType !== "POP") {
      window.scrollTo(0, 0);
      return;
    }

    const target = recall(key);
    if (target == null || target <= 0) {
      window.scrollTo(0, 0);
      return;
    }

    const startedAt = Date.now();
    const attempt = () => {
      const docHeight = document.documentElement.scrollHeight;
      const viewport = window.innerHeight;

      if (canRestore(target, docHeight, viewport)) {
        window.scrollTo(0, target);
        return;
      }
      if (shouldKeepTrying(Date.now() - startedAt, RESTORE_TIMEOUT_MS)) {
        frame.current = requestAnimationFrame(attempt);
        return;
      }
      // Out of time: the content is not coming, or came back shorter. Landing
      // as close as the page allows beats landing at the top.
      window.scrollTo(0, clampOffset(target, docHeight, viewport));
    };

    frame.current = requestAnimationFrame(attempt);
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [pathname, search, hash, key, navType]);

  return null;
};

export default ScrollToTop;
