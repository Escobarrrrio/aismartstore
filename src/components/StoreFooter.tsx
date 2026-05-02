import { Link } from "react-router-dom";
import { Mail, MapPin, Phone } from "lucide-react";
import logo from "@/assets/logo.png";

const StoreFooter = () => {
  return (
    <footer className="bg-foreground mt-16">
      <div className="container mx-auto px-4 pt-10 pb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 mb-8">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <img src={logo} alt="AI Smart Store" className="h-8 w-8 object-contain" />
              <span className="font-display font-extrabold text-sm gradient-brand-text">Smart Store</span>
            </div>
            <p className="text-white/40 text-sm leading-relaxed">
              Your premium destination for AI and tech products in South Africa.
            </p>
          </div>

          {/* Quick Links */}
          <div>
            <h5 className="font-display font-bold text-sm text-white mb-3">Quick Links</h5>
            <nav className="flex flex-col gap-1.5">
              <Link to="/" className="text-white/40 text-sm hover:text-white transition-colors">Home</Link>
              <Link to="/products" className="text-white/40 text-sm hover:text-white transition-colors">Products</Link>
              <Link to="/cart" className="text-white/40 text-sm hover:text-white transition-colors">Cart</Link>
            </nav>
          </div>

          {/* Support */}
          <div>
            <h5 className="font-display font-bold text-sm text-white mb-3">Support</h5>
            <nav className="flex flex-col gap-1.5">
              <Link to="/auth" className="text-white/40 text-sm hover:text-white transition-colors">Login / Register</Link>
              <span className="text-white/40 text-sm">Shipping & Returns</span>
              <span className="text-white/40 text-sm">Terms & Conditions</span>
            </nav>
          </div>

          {/* Contact */}
          <div>
            <h5 className="font-display font-bold text-sm text-white mb-3">Contact</h5>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-white/40 text-sm">
                <Mail className="h-3.5 w-3.5 text-white/25" />
                fsteyn@rocketmail.com
              </div>
              <div className="flex items-center gap-2 text-white/40 text-sm">
                <MapPin className="h-3.5 w-3.5 text-white/25" />
                South Africa
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-white/[0.07] pt-5 flex items-center justify-between flex-wrap gap-3">
          <p className="text-white/25 text-xs">
            © {new Date().getFullYear()} AI Smart Store. All rights reserved.
          </p>
          <p className="text-white/25 text-xs">
            store.aijobchommie.co.za
          </p>
        </div>
      </div>
    </footer>
  );
};

export default StoreFooter;
