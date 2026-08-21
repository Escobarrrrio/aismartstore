import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Suspense, lazy } from "react";
import Index from "./pages/Index";
import { HelmetProvider } from "react-helmet-async";
import { CartProvider } from "@/contexts/CartContext";
import { WishlistProvider } from "@/contexts/WishlistContext";
import { ProductProvider } from "@/contexts/ProductContext";
import { LocaleProvider } from "@/contexts/LocaleContext";
import { AudienceProvider } from "@/contexts/AudienceContext";
import StoreHeader from "@/components/StoreHeader";
import StoreFooter from "@/components/StoreFooter";
import ChatWidget from "@/components/ChatWidget";
import AudienceGuard from "@/components/AudienceGuard";
import ScrollToTop from "@/components/ScrollToTop";
import ScrollButtons from "@/components/ScrollButtons";
import IdleSessionGuard from "@/components/IdleSessionGuard";
import CookieConsentBanner from "@/components/CookieConsentBanner";
import PageViewTracker from "@/components/PageViewTracker";

// Route-level code splitting: the Admin panel alone pulls in dozens of
// modules (products, orders, customers, support, sync logs, automations,
// security, etc.) that a regular shopper never needs. Lazy-loading keeps
// those out of the bundle everyone downloads just to browse the store.
const Products = lazy(() => import("./pages/Products"));
const ProductDetail = lazy(() => import("./pages/ProductDetail"));
const Cart = lazy(() => import("./pages/Cart"));
const Checkout = lazy(() => import("./pages/Checkout"));
const Admin = lazy(() => import("./pages/Admin"));
const Pitch = lazy(() => import("./pages/Pitch"));
const Auth = lazy(() => import("./pages/Auth"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const Account = lazy(() => import("./pages/Account"));
const OrderTracking = lazy(() => import("./pages/OrderTracking"));
const Procurement = lazy(() => import("./pages/Procurement"));
const AiPulse = lazy(() => import("./pages/AiPulse"));
const Compliance = lazy(() => import("./pages/Compliance"));
const About = lazy(() => import("./pages/About"));
const Vision = lazy(() => import("./pages/Vision"));
const Mission = lazy(() => import("./pages/Mission"));
const ShippingReturns = lazy(() => import("./pages/ShippingReturns"));
const Terms = lazy(() => import("./pages/Terms"));
const CookiePolicy = lazy(() => import("./pages/CookiePolicy"));
const Contact = lazy(() => import("./pages/Contact"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

const RouteFallback = () => (
  <div className="flex items-center justify-center min-h-[60vh]">
    <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
  </div>
);

// Storefront pages get the shared header/footer/chat chrome. The Admin
// control centre renders its own sidebar + top bar, so it deliberately
// does not get wrapped in this -- doing so previously produced duplicate
// navigation chrome stacked above the admin layout.
const StorefrontLayout = ({ children }: { children: React.ReactNode }) => (
  <div className="flex flex-col min-h-screen">
    <StoreHeader />
    <main className="flex-1">{children}</main>
    <StoreFooter />
    <ChatWidget />
    <CookieConsentBanner />
  </div>
);

const App = () => (
  <HelmetProvider>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <LocaleProvider>
         <AudienceProvider>
          <ProductProvider>
            <CartProvider>
              <WishlistProvider>
                <Toaster />
                <Sonner />
                {/* Vercel's own visitor/pageview dashboard -- separate from
                    PageViewTracker below, which feeds our first-party
                    Admin > Analytics screen. Harmless to run both: this one
                    costs nothing extra to ship and gives a glance at traffic
                    right in the Vercel dashboard without an admin login. */}
                <Analytics />
                {/* Vercel Speed Insights: real-user Core Web Vitals (LCP,
                    INP, CLS, TTFB, FCP) collected from actual visitors,
                    shown in the same Vercel dashboard as Analytics above.
                    /react (not /next) since this is a Vite SPA, not Next.js. */}
                <SpeedInsights />
                <BrowserRouter>
                  <ScrollToTop />
                  <ScrollButtons />
                  <PageViewTracker />
                  {/* Ends abandoned sessions; inert for anonymous visitors. */}
                  <IdleSessionGuard />
                  <Suspense fallback={<RouteFallback />}>
                    <Routes>
                      <Route path="/" element={<StorefrontLayout><Index /></StorefrontLayout>} />
                      <Route path="/products" element={<StorefrontLayout><Products /></StorefrontLayout>} />
                      <Route path="/product/:id" element={<StorefrontLayout><ProductDetail /></StorefrontLayout>} />
                      <Route path="/cart" element={<StorefrontLayout><Cart /></StorefrontLayout>} />
                      <Route path="/checkout" element={<StorefrontLayout><Checkout /></StorefrontLayout>} />
                      <Route path="/account" element={<StorefrontLayout><Account /></StorefrontLayout>} />
                      <Route path="/orders/:id" element={<StorefrontLayout><OrderTracking /></StorefrontLayout>} />
                      <Route path="/auth" element={<StorefrontLayout><Auth /></StorefrontLayout>} />
                      <Route path="/reset-password" element={<StorefrontLayout><ResetPassword /></StorefrontLayout>} />
                      <Route path="/procurement" element={<StorefrontLayout><AudienceGuard allow="business"><Procurement /></AudienceGuard></StorefrontLayout>} />
                      <Route path="/ai-pulse" element={<StorefrontLayout><AiPulse /></StorefrontLayout>} />
                      <Route path="/compliance" element={<StorefrontLayout><Compliance /></StorefrontLayout>} />
                      <Route path="/about" element={<StorefrontLayout><About /></StorefrontLayout>} />
                      <Route path="/vision" element={<StorefrontLayout><Vision /></StorefrontLayout>} />
                      <Route path="/mission" element={<StorefrontLayout><Mission /></StorefrontLayout>} />
                      <Route path="/shipping-returns" element={<StorefrontLayout><ShippingReturns /></StorefrontLayout>} />
                      <Route path="/terms" element={<StorefrontLayout><Terms /></StorefrontLayout>} />
                      <Route path="/cookies" element={<StorefrontLayout><CookiePolicy /></StorefrontLayout>} />
                      <Route path="/contact" element={<StorefrontLayout><Contact /></StorefrontLayout>} />
                      <Route path="/admin" element={<Admin />} />
                      <Route path="/pitch" element={<Pitch />} />
                      <Route path="*" element={<StorefrontLayout><NotFound /></StorefrontLayout>} />
                    </Routes>
                  </Suspense>
                </BrowserRouter>
              </WishlistProvider>
            </CartProvider>
          </ProductProvider>
         </AudienceProvider>
        </LocaleProvider>
      </TooltipProvider>
    </QueryClientProvider>
  </HelmetProvider>
);

export default App;
