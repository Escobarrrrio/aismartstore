import { useEffect, useState } from "react";
import { ArrowUp, ArrowDown } from "lucide-react";

/**
 * Jump to the top or the bottom of a long page.
 *
 * The catalogue runs to sixty cards a page and the product page runs long on a
 * phone. Getting back to the search box, or down to the footer's contact and
 * policy links, is otherwise a lot of thumb.
 *
 * Two rules keep it from becoming clutter:
 *
 *   * It only appears once there is somewhere to go -- past one screen of
 *     scrolling. On a short page it never shows at all.
 *   * Each arrow hides when it would do nothing. At the top there is no "up",
 *     at the bottom there is no "down". A button that visibly does nothing
 *     when pressed teaches people to stop trusting the buttons.
 *
 * Sits above the chat widget rather than under it -- the widget is bottom-right
 * and fixed, so this is offset to clear it on every screen size.
 */
const ScrollButtons = () => {
  const [show, setShow] = useState(false);
  const [atTop, setAtTop] = useState(true);
  const [atBottom, setAtBottom] = useState(false);

  useEffect(() => {
    const update = () => {
      const y = window.scrollY;
      const viewport = window.innerHeight;
      const height = document.documentElement.scrollHeight;

      setShow(height - viewport > viewport * 0.75);
      setAtTop(y < 120);
      // A tolerance, because sub-pixel layout and mobile browser chrome mean
      // the arithmetic rarely lands exactly on zero.
      setAtBottom(y + viewport >= height - 120);
    };

    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  if (!show) return null;

  // `smooth` unless the reader has asked for less motion, which some people
  // need rather than prefer.
  const behavior: ScrollBehavior =
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth";

  const btn =
    "grid place-items-center h-11 w-11 rounded-full bg-background/95 backdrop-blur border border-border " +
    "shadow-lg text-foreground hover:bg-muted active:scale-95 transition " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

  return (
    <div className="fixed right-4 bottom-24 sm:bottom-28 z-30 flex flex-col gap-2 print:hidden">
      {!atTop && (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior })}
          aria-label="Scroll to top"
          title="Back to top"
          className={btn}
        >
          <ArrowUp className="h-5 w-5" />
        </button>
      )}
      {!atBottom && (
        <button
          type="button"
          onClick={() =>
            window.scrollTo({ top: document.documentElement.scrollHeight, behavior })
          }
          aria-label="Scroll to bottom"
          title="Jump to bottom"
          className={btn}
        >
          <ArrowDown className="h-5 w-5" />
        </button>
      )}
    </div>
  );
};

export default ScrollButtons;
