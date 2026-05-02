import { Link } from "react-router-dom";
import { ShoppingCart, Menu, X, Search, User } from "lucide-react";
import { useCart } from "@/contexts/CartContext";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import logo from "@/assets/logo.png";

const StoreHeader = () => {
  const { totalItems } = useCart();
  const [menuOpen, setMenuOpen] = useState(false);
  const [session, setSession] = useState<any>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => setSession(session));
    return () => subscription.unsubscribe();
  }, []);

  return (
    <header className="sticky top-0 z-50 bg-background/97 backdrop-blur-xl border-b border-border">
      <div className="container mx-auto flex items-center gap-4 h-16 px-4 lg:px-6">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2 flex-shrink-0">
          <img src={logo} alt="AI Smart Store" className="h-10 w-10 object-contain" />
          <span className="font-display font-extrabold text-lg gradient-brand-text whitespace-nowrap">
            Smart Store
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-1 ml-4">
          <Link to="/" className="font-display font-medium text-sm text-muted-foreground px-3 py-1.5 rounded-full hover:bg-muted hover:text-foreground transition-all">
            Home
          </Link>
          <Link to="/products" className="font-display font-medium text-sm text-muted-foreground px-3 py-1.5 rounded-full hover:bg-muted hover:text-foreground transition-all">
            Products
          </Link>
        </nav>

        {/* Actions */}
        <div className="flex items-center gap-2 ml-auto">
          {/* Search */}
          <div className="hidden sm:flex items-center gap-2 bg-muted border border-border rounded-full px-3 py-1.5">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search products..."
              className="bg-transparent border-none outline-none text-sm w-28 lg:w-36 text-foreground placeholder:text-muted-foreground font-sans"
            />
          </div>

          {/* Cart */}
          <Link
            to="/cart"
            className="relative gradient-brand text-primary-foreground rounded-full px-3 py-1.5 font-display font-semibold text-sm flex items-center gap-1.5 hover:opacity-90 transition-opacity"
          >
            <ShoppingCart className="h-4 w-4" />
            <span className="hidden sm:inline">Cart</span>
            {totalItems > 0 && (
              <span className="absolute -top-1.5 -right-1.5 h-[18px] w-[18px] rounded-full bg-[#d94fd5] text-white text-[10px] font-bold flex items-center justify-center border-2 border-background shadow-md">
                {totalItems}
              </span>
            )}
          </Link>

          {/* Auth */}
          {session ? (
            <Link
              to="/admin"
              className="flex items-center gap-2 bg-muted border border-border rounded-full px-2 py-1 hover:bg-border transition-colors"
            >
              <div className="w-7 h-7 rounded-full gradient-brand flex items-center justify-center text-white text-xs font-bold font-display">
                {session.user?.email?.[0]?.toUpperCase() || "A"}
              </div>
              <span className="text-sm font-display font-semibold pr-1 hidden sm:inline">
                Admin
              </span>
            </Link>
          ) : (
            <Link
              to="/auth"
              className="border border-border rounded-full px-3 py-1.5 font-display font-semibold text-sm flex items-center gap-1.5 hover:border-secondary hover:bg-muted transition-all"
            >
              <User className="h-4 w-4" />
              <span className="hidden sm:inline">Login / Register</span>
            </Link>
          )}

          {/* Mobile hamburger */}
          <button onClick={() => setMenuOpen(!menuOpen)} className="md:hidden p-1.5">
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="md:hidden border-t border-border bg-background">
          <nav className="container mx-auto px-4 py-4 flex flex-col gap-1">
            <Link to="/" onClick={() => setMenuOpen(false)} className="py-2.5 font-display font-semibold text-sm border-b border-border flex items-center gap-3">
              Home
            </Link>
            <Link to="/products" onClick={() => setMenuOpen(false)} className="py-2.5 font-display font-semibold text-sm border-b border-border flex items-center gap-3">
              Products
            </Link>
            {session ? (
              <Link to="/admin" onClick={() => setMenuOpen(false)} className="py-2.5 font-display font-semibold text-sm flex items-center gap-3">
                Admin Panel
              </Link>
            ) : (
              <Link to="/auth" onClick={() => setMenuOpen(false)} className="py-2.5 font-display font-semibold text-sm flex items-center gap-3">
                Login / Register
              </Link>
            )}
          </nav>
        </div>
      )}
    </header>
  );
};

export default StoreHeader;
