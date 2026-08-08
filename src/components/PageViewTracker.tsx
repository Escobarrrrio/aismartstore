import { usePageViewTracking } from "@/hooks/usePageViewTracking";

/**
 * Rendered once inside <BrowserRouter> alongside ScrollToTop/ScrollButtons --
 * same "invisible, route-aware utility component" pattern, not a visible UI
 * element. See usePageViewTracking.ts for what it actually does.
 */
const PageViewTracker = () => {
  usePageViewTracking();
  return null;
};

export default PageViewTracker;
