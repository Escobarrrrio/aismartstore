import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Suspense, lazy } from "react";
import Index from "./pages/Index";
import { HelmetProvider } from "react-helmet-async";
import { CartProvider } from "@/contexts/CartContext";
import { ProductProvider } from "@/contexts/ProductContext";
import { LocaleProvider } from "@/contexts/LocaleContext";
import StoreHeader from "@/components/StoreHeader";
import StoreFooter from "@/components/StoreFooter";
import ChatWidget from "@/components/ChatWidget";

// Route-level code splitting: the Admin panel alone pulls in dozens of
// modules (products, orders, customers, support, sync logs, automations,
// security, etc.) that a regular shopper never needs. Lazy-loading keeps
// those out of the bundle everyone downloads just to browse the store.
const Products = lazy(() => import("./pages/Products"));
const ProductDetail = lazy(() => import("./pages/ProductDetail"));
const Cart = lazy(() => import("./pages/Cart"));
const Checkout = lazy(() => import("./pages/Checkout"));
const Admin = lazy(() => import("./pages/Admin"));
const Auth = lazy(() => import("./pages/Auth"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const Account = lazy(() => import("./pages/Account"));
const Procurement = lazy(() => import("./pages/Procurement"));
const AiPulse = lazy(() => import("./pages/AiPulse"));
const Compliance = lazy(() => import("./pages/Compliance"));
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
  </div>
);

const App = () => (
  <HelmetProvider>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <LocaleProvider>
          <ProductProvider>
            <CartProvider>
              <Toaster />
              <Sonner />
              <BrowserRouter>
                <Suspense fallback={<RouteFallback />}>
                  <Routes>
                    <Route path="/" element={<StorefrontLayout><Index /></StorefrontLayout>} />
                    <Route path="/products" element={<StorefrontLayout><Products /></StorefrontLayout>} />
                    <Route path="/product/:id" element={<StorefrontLayout><ProductDetail /></StorefrontLayout>} />
                    <Route path="/cart" element={<StorefrontLayout><Cart /></StorefrontLayout>} />
                    <Route path="/checkout" element={<StorefrontLayout><Checkout /></StorefrontLayout>} />
                    <Route path="/account" element={<StorefrontLayout><Account /></StorefrontLayout>} />
                    <Route path="/auth" element={<StorefrontLayout><Auth /></StorefrontLayout>} />
                    <Route path="/reset-password" element={<StorefrontLayout><ResetPassword /></StorefrontLayout>} />
                    <Route path="/procurement" element={<StorefrontLayout><Procurement /></StorefrontLayout>} />
                    <Route path="/ai-pulse" element={<StorefrontLayout><AiPulse /></StorefrontLayout>} />
                    <Route path="/compliance" element={<StorefrontLayout><Compliance /></StorefrontLayout>} />
                    <Route path="/admin" element={<Admin />} />
                    <Route path="*" element={<StorefrontLayout><NotFound /></StorefrontLayout>} />
                  </Routes>
                </Suspense>
              </BrowserRouter>
            </CartProvider>
          </ProductProvider>
        </LocaleProvider>
      </TooltipProvider>
    </QueryClientProvider>
  </HelmetProvider>
);

export default App;
