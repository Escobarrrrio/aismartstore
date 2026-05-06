import { Link, useLocation } from "react-router-dom";
import { ShoppingCart, Menu, X, Search, User, ChevronDown } from "lucide-react";
import { useCart } from "@/contexts/CartContext";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

const StoreHeader = () => {
  const { totalItems } = useCart();
  const [menuOpen, setMenuOpen] = useState(false);
  const [session, setSession] = useState<any>(null);
  const [scrolled, setScrolled] = useState(false);
  const location = useLocation();

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

  // Hide header on admin pages
  if (location.pathname === "/admin") return null;

  return (
    <header className={`sticky top-0 z-50 transition-all duration-300 ${scrolled ? 'bg-background/95 backdrop-blur-xl shadow-sm border-b border-border' : 'bg-background border-b border-transparent'}`}>
      <div className="container mx-auto flex items-center h-16 px-4 lg:px-6">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2.5 flex-shrink-0 mr-8">
          <div className="w-9 h-9 rounded-xl gradient-brand flex items-center justify-center text-white font-display font-extrabold text-sm">S</div>
          <span className="font-display font-extrabold text-lg tracking-tight hidden sm:block">
            Smart Store
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-1">
          {[
            { to: "/", label: "Home" },
            { to: "/products", label: "Products" },
          ].map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
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
        <div className="flex items-center gap-2 ml-auto">
          {/* Search */}
          <div className="hidden sm:flex items-center gap-2 bg-muted rounded-xl px-3.5 py-2 border border-transparent focus-within:border-primary/20 focus-within:bg-background transition-all">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search products..."
              className="bg-transparent border-none outline-none text-sm w-32 lg:w-44 text-foreground placeholder:text-muted-foreground"
            />
          </div>

          {/* Cart */}
          <Link
            to="/cart"
            className="relative flex items-center gap-2 h-10 px-4 rounded-xl bg-foreground text-background text-sm font-semibold hover:bg-foreground/90 transition-colors"
          >
            <ShoppingCart className="h-4 w-4" />
            <span className="hidden sm:inline">Cart</span>
            {totalItems > 0 && (
              <span className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full gradient-brand text-white text-[10px] font-bold flex items-center justify-center shadow-md">
                {totalItems}
              </span>
            )}
          </Link>

          {/* Auth */}
          {session ? (
            <div className="flex items-center gap-2">
              <Link
                to="/account"
                className="flex items-center gap-2 h-10 px-3 rounded-xl border border-border hover:bg-muted transition-colors"
              >
                <User className="h-4 w-4" />
                <span className="text-sm font-medium hidden sm:inline">My Account</span>
              </Link>
              <Link
                to="/admin"
                className="flex items-center gap-2 h-10 px-3 rounded-xl gradient-brand text-white hover:opacity-90 transition-opacity"
              >
                <div className="w-6 h-6 rounded-md bg-white/20 flex items-center justify-center text-white text-xs font-bold font-display">
                  {session.user?.email?.[0]?.toUpperCase() || "A"}
                </div>
                <span className="text-sm font-medium hidden sm:inline">Admin</span>
              </Link>
            </div>
          ) : (
            <Link
              to="/auth"
              className="flex items-center gap-2 h-10 px-4 rounded-xl border border-border text-sm font-medium hover:bg-muted transition-colors"
            >
              <User className="h-4 w-4" />
              <span className="hidden sm:inline">Login / Register</span>
            </Link>
          )}

          {/* Mobile hamburger */}
          <button onClick={() => setMenuOpen(!menuOpen)} className="md:hidden p-2 rounded-lg hover:bg-muted transition-colors">
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="md:hidden border-t border-border bg-background animate-fade-in">
          <nav className="container mx-auto px-4 py-3 flex flex-col gap-1">
            {[
              { to: "/", label: "Home" },
              { to: "/products", label: "Products" },
              { to: "/cart", label: "Cart" },
              session ? { to: "/admin", label: "Admin Panel" } : { to: "/auth", label: "Login / Register" },
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
