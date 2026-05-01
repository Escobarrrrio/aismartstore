import { Link } from "react-router-dom";
import { ShoppingCart, Menu, X } from "lucide-react";
import { useCart } from "@/contexts/CartContext";
import { useState } from "react";
import logo from "@/assets/logo.png";

const StoreHeader = () => {
  const { totalItems } = useCart();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 glass-card border-b border-border/50">
      <div className="container mx-auto px-4 py-3 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3 group">
          <img src={logo} alt="AI Smart Store" className="h-10 w-10 object-contain" />
          <div className="flex flex-col leading-tight">
            <span className="text-lg font-brand font-bold gradient-brand-text tracking-tight">
              Smart Store
            </span>
          </div>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-8">
          <Link to="/" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
            Home
          </Link>
          <Link to="/products" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
            Products
          </Link>
          <Link to="/admin" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
            Admin
          </Link>
          <Link to="/cart" className="relative p-2 rounded-full hover:bg-accent transition-colors">
            <ShoppingCart className="h-5 w-5 text-foreground" />
            {totalItems > 0 && (
              <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full gradient-brand flex items-center justify-center text-xs font-bold text-primary-foreground">
                {totalItems}
              </span>
            )}
          </Link>
        </nav>

        {/* Mobile */}
        <div className="flex md:hidden items-center gap-3">
          <Link to="/cart" className="relative p-2">
            <ShoppingCart className="h-5 w-5 text-foreground" />
            {totalItems > 0 && (
              <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full gradient-brand flex items-center justify-center text-xs font-bold text-primary-foreground">
                {totalItems}
              </span>
            )}
          </Link>
          <button onClick={() => setMenuOpen(!menuOpen)} className="p-2">
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="md:hidden border-t border-border/50 bg-card/95 backdrop-blur-xl">
          <nav className="container mx-auto px-4 py-4 flex flex-col gap-3">
            <Link to="/" onClick={() => setMenuOpen(false)} className="py-2 text-sm font-medium">Home</Link>
            <Link to="/products" onClick={() => setMenuOpen(false)} className="py-2 text-sm font-medium">Products</Link>
            <Link to="/admin" onClick={() => setMenuOpen(false)} className="py-2 text-sm font-medium">Admin</Link>
          </nav>
        </div>
      )}
    </header>
  );
};

export default StoreHeader;
