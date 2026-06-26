import { Link, useLocation } from "react-router-dom";
import { Mail, MapPin, Phone, Shield, Truck, CreditCard } from "lucide-react";

const StoreFooter = () => {
  const location = useLocation();
  if (location.pathname === "/admin") return null;

  return (
    <footer className="bg-foreground text-background/60 mt-auto">
      {/* Reassurance bar */}
      <div className="border-b border-background/[0.06]">
        <div className="container mx-auto px-4 py-8">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {[
              { icon: Truck, title: "Free Shipping Over R500", desc: "Fast SA-wide delivery" },
              { icon: Shield, title: "Secure & Trusted", desc: "SSL encrypted checkout" },
              { icon: CreditCard, title: "Easy Payments", desc: "Yoco card payments accepted" },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-background/[0.06] flex items-center justify-center flex-shrink-0">
                  <item.icon className="h-5 w-5 text-background/40" />
                </div>
                <div>
                  <p className="text-sm font-display font-semibold text-background/80">{item.title}</p>
                  <p className="text-xs text-background/30">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 pt-10 pb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 mb-10">
          {/* Brand */}
          <div>
            <div className="mb-4">
              <Logo size={28} invert />
            </div>
            <p className="text-sm leading-relaxed text-background/40 mb-4">
              South Africa's premium destination for AI hardware, networking, and enterprise technology solutions.
            </p>
          </div>

          {/* Shop */}
          <div>
            <h5 className="font-display font-bold text-sm text-background/90 mb-4">Shop</h5>
            <nav className="flex flex-col gap-2">
              <Link to="/products" className="text-sm hover:text-background/80 transition-colors">All Products</Link>
              <Link to="/products" className="text-sm hover:text-background/80 transition-colors">AI & Hardware</Link>
              <Link to="/products" className="text-sm hover:text-background/80 transition-colors">Networking</Link>
              <Link to="/products" className="text-sm hover:text-background/80 transition-colors">Software</Link>
            </nav>
          </div>

          {/* Support */}
          <div>
            <h5 className="font-display font-bold text-sm text-background/90 mb-4">Support</h5>
            <nav className="flex flex-col gap-2">
              <Link to="/auth" className="text-sm hover:text-background/80 transition-colors">Login / Register</Link>
              <span className="text-sm">Shipping & Returns</span>
              <span className="text-sm">Terms & Conditions</span>
              <span className="text-sm">Privacy Policy</span>
            </nav>
          </div>

          {/* Contact */}
          <div>
            <h5 className="font-display font-bold text-sm text-background/90 mb-4">Contact</h5>
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2.5 text-sm">
                <Mail className="h-4 w-4 text-background/25 flex-shrink-0" />
                fsteyn@rocketmail.com
              </div>
              <div className="flex items-center gap-2.5 text-sm">
                <MapPin className="h-4 w-4 text-background/25 flex-shrink-0" />
                South Africa
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-background/[0.06] pt-6 flex items-center justify-between flex-wrap gap-3">
          <p className="text-xs text-background/25">
            © {new Date().getFullYear()} AI Smart Store. All rights reserved.
          </p>
          <p className="text-xs text-background/25">
            store.aijobchommie.co.za
          </p>
        </div>
      </div>
    </footer>
  );
};

export default StoreFooter;
