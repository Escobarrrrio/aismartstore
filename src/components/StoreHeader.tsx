import { Link, useLocation } from "react-router-dom";
import { ShoppingCart, Menu, X, Search, User, ShieldCheck } from "lucide-react";
import { useCart } from "@/contexts/CartContext";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTranslation } from "react-i18next";
import LanguageCurrencySwitcher from "@/components/LanguageCurrencySwitcher";
import Logo from "@/components/Logo";
import HeaderSearch from "@/components/HeaderSearch";
import { useIsAdmin } from "@/hooks/useIsAdmin";


const StoreHeader = () => {
  const { totalItems } = useCart();
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [session, setSession] = useState<any>(null);
  const [scrolled, setScrolled] = useState(false);
  const location = useLocation();
  const isAdmin = useIsAdmin(session);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => setSession(session));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  const isActive = (path: string) => location.pathname === path;

  if (location.pathname === "/admin") return null;

  return (
    <header className={`sticky top-0 z-50 w-full max-w-full transition-all duration-300 ${scrolled ? 'bg-background/95 backdrop-blur-xl shadow-sm border-b border-border' : 'bg-background border-b border-transparent'}`}>
      <div className="container mx-auto flex items-center h-16 px-4 lg:px-6 max-w-full">
        {/* Logo */}
        <div className="flex-shrink-0 mr-4 lg:mr-8 min-w-0">
          <Logo size={32} />
        </div>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-1 min-w-0">
          {[
            { to: "/", label: t("nav.home") },
            { to: "/products", label: t("nav.products") },
            { to: "/ai-pulse", label: t("nav.aiPulse") },
            { to: "/procurement", label: t("nav.procurement") },
          ].map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className={`px-3 lg:px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                isActive(link.to)
                  ? 'text-primary bg-primary/[0.06]'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Right actions */}
        <div className="flex items-center gap-1.5 sm:gap-2 ml-auto min-w-0">
          {/* Search - desktop */}
          <div className="hidden lg:block">
            <HeaderSearch />
          </div>

          {/* Mobile search toggle */}
          <button
            onClick={() => setMobileSearchOpen((v) => !v)}
            className="lg:hidden p-2 rounded-lg hover:bg-muted transition-colors"
            aria-label="Search"
          >
            <Search className="h-5 w-5" />
          </button>

          <LanguageCurrencySwitcher />

          {isAdmin && (
            <Link
              to="/admin"
              className="hidden sm:flex items-center gap-2 h-10 px-3 rounded-xl border border-border hover:bg-muted transition-colors"
            >
              <ShieldCheck className="h-4 w-4" />
              <span className="text-sm font-medium hidden md:inline">{t("nav.admin")}</span>
            </Link>
          )}

          {/* Cart - now gradient pill matching brand */}
          <Link
            to="/cart"
            aria-label={`${t("nav.cart")}${totalItems > 0 ? `, ${totalItems} items` : ""}`}
            className="relative flex items-center gap-2 h-10 px-3 sm:px-4 rounded-xl gradient-brand text-white text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            <ShoppingCart className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
            <span className="hidden sm:inline">{t("nav.cart")}</span>
            {totalItems > 0 && (
              <span aria-hidden="true" className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-foreground text-background text-[10px] font-bold flex items-center justify-center shadow-md">
                {totalItems}
              </span>
            )}
          </Link>

          {/* Auth */}
          {session ? (
            <Link
              to="/account"
              className="hidden sm:flex items-center gap-2 h-10 px-3 rounded-xl border border-border hover:bg-muted transition-colors"
            >
              <User className="h-4 w-4" />
              <span className="text-sm font-medium hidden md:inline">{t("nav.account")}</span>
            </Link>
          ) : (
            <Link
              to="/auth"
              className="hidden sm:flex items-center gap-2 h-10 px-3 sm:px-4 rounded-xl border border-border text-sm font-medium hover:bg-muted transition-colors whitespace-nowrap"
            >
              <User className="h-4 w-4" />
              <span className="hidden md:inline">{t("nav.login")}</span>
            </Link>
          )}

          {/* Mobile hamburger */}
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="md:hidden p-2 rounded-lg hover:bg-muted transition-colors"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav-menu"
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile expandable search */}
      {mobileSearchOpen && (
        <div className="lg:hidden border-t border-border bg-background px-4 py-3 animate-fade-in">
          <HeaderSearch fullWidth autoFocus onClose={() => setMobileSearchOpen(false)} />
        </div>
      )}


      {/* Mobile menu */}
      {menuOpen && (
        <div id="mobile-nav-menu" className="md:hidden border-t border-border bg-background animate-fade-in">
          <nav className="container mx-auto px-4 py-3 flex flex-col gap-1 max-w-full">
            {[
              { to: "/", label: t("nav.home") },
              { to: "/products", label: t("nav.products") },
              { to: "/ai-pulse", label: t("nav.aiPulse") },
              { to: "/procurement", label: t("nav.procurement") },
              { to: "/cart", label: t("nav.cart") },
              ...(session ? [
                { to: "/account", label: t("nav.account") },
                ...(isAdmin ? [{ to: "/admin", label: t("nav.admin") }] : []),
              ] : [
                { to: "/auth", label: t("nav.login") },
              ]),
            ].map((link) => (
              <Link
                key={link.to}
                to={link.to}
                onClick={() => setMenuOpen(false)}
                className={`py-3 px-3 rounded-lg text-sm font-medium transition-colors ${
                  isActive(link.to) ? 'text-primary bg-primary/[0.06]' : 'text-foreground hover:bg-muted'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
};

export default StoreHeader;
