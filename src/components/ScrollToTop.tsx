import { useEffect } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

/**
 * Reset scroll to top when navigating to a NEW route (PUSH/REPLACE), but
 * preserve the browser's native scroll restoration on back/forward (POP)
 * so shoppers returning from a product detail land where they left off in
 * the long product grid. Also respect in-page hash anchors.
 */
const ScrollToTop = () => {
  const { pathname, hash } = useLocation();
  const navType = useNavigationType();

  useEffect(() => {
    if (navType === "POP") return; // let the browser restore prior offset
    if (hash) return; // anchor link — let the browser handle it
    window.scrollTo(0, 0);
  }, [pathname, hash, navType]);

  return null;
};

export default ScrollToTop;
