import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * React Router doesn't reset scroll position on navigation -- it's a DOM
 * update, not a real page load, so clicking a product from partway down
 * the grid lands on the new page at the same scroll offset (often past
 * its fold entirely). Reset to top on every path change.
 */
const ScrollToTop = () => {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
};

export default ScrollToTop;
