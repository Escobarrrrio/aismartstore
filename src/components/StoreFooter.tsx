import { Link, useLocation } from "react-router-dom";
import { Mail, MapPin, Phone, Shield, Truck, CreditCard, Lock, ShieldCheck, BadgeCheck } from "lucide-react";
import Logo from "@/components/Logo";
import NewsletterSignup from "@/components/NewsletterSignup";

const StoreFooter = () => {
  const location = useLocation();
  if (location.pathname === "/admin") return null;

  return (
    <footer className="bg-foreground text-background/80 mt-auto print:hidden">
      {/* Reassurance bar */}
      <div className="border-b border-background/[0.06]">
        <div className="container mx-auto px-4 py-8">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {[
              { icon: Truck, title: "Courier Delivery", desc: "SA-wide via The Courier Guy" },
              { icon: Shield, title: "Secure & Trusted", desc: "SSL encrypted checkout" },
              { icon: CreditCard, title: "Easy Payments", desc: "Yoco card payments accepted" },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-background/[0.06] flex items-center justify-center flex-shrink-0">
                  <item.icon className="h-5 w-5 text-background/75" />
                </div>
                <div>
                  <p className="text-sm font-display font-semibold text-background/80">{item.title}</p>
                  <p className="text-xs text-background/70">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 pt-10 pb-6">
        {/* Five columns now that Company is its own rather than four. Six
            tracks, with the brand column taking two: it carries the newsletter
            form, and at five equal tracks the email input is the thing that
            gets squeezed. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-8 mb-10">
          {/* Brand */}
          <div className="lg:col-span-2">
            <div className="mb-4">
              <Logo size={28} invert />
            </div>
            <p className="text-sm leading-relaxed text-background/75 mb-5">
              The world's premium destination for AI hardware, networking, and enterprise technology solutions.
            </p>
            <NewsletterSignup source="footer" />
          </div>

          {/* Shop */}
          <div>
            <h5 className="font-display font-bold text-sm text-background/90 mb-4">Shop</h5>
            <nav className="flex flex-col gap-2">
              <Link to="/products" className="text-sm hover:text-background/80 transition-colors">All Products</Link>
              <Link to="/products?ai=1" className="text-sm hover:text-background/80 transition-colors">AI & Hardware</Link>
              <Link to={`/products?category=${encodeURIComponent("Networking")}`} className="text-sm hover:text-background/80 transition-colors">Networking</Link>
              <Link to={`/products?category=${encodeURIComponent("Software & Licensing")}`} className="text-sm hover:text-background/80 transition-colors">Software</Link>
            </nav>
          </div>

          {/* Company. Split out of Support, where the founder's story sat between
              "Login / Register" and "Shipping & Returns" -- three pages nobody
              would think to look for under a heading that promises help with an
              order. They are the reason someone buys from a one-man shop rather
              than Takealot; they should not be filed as an admin link. */}
          <div>
            <h5 className="font-display font-bold text-sm text-background/90 mb-4">Company</h5>
            <nav className="flex flex-col gap-2">
              <Link to="/about" className="text-sm hover:text-background/80 transition-colors">Our Story</Link>
              <Link to="/vision" className="text-sm hover:text-background/80 transition-colors">Vision</Link>
              <Link to="/mission" className="text-sm hover:text-background/80 transition-colors">Mission</Link>
              <Link to="/procurement" className="text-sm hover:text-background/80 transition-colors">Business &amp; Government</Link>
            </nav>
          </div>

          {/* Support */}
          <div>
            <h5 className="font-display font-bold text-sm text-background/90 mb-4">Support</h5>
            <nav className="flex flex-col gap-2">
              <Link to="/contact" className="text-sm hover:text-background/80 transition-colors">Contact & Support</Link>
              <Link to="/auth" className="text-sm hover:text-background/80 transition-colors">Login / Register</Link>
              <Link to="/shipping-returns" className="text-sm hover:text-background/80 transition-colors">Shipping & Returns</Link>
              <Link to="/compliance" className="text-sm hover:text-background/80 transition-colors">Privacy (POPIA)</Link>
              <Link to="/compliance" className="text-sm hover:text-background/80 transition-colors">PAIA Manual</Link>
              <Link to="/terms" className="text-sm hover:text-background/80 transition-colors">Terms of Service</Link>
              <Link to="/cookies" className="text-sm hover:text-background/80 transition-colors">Cookie Policy</Link>
            </nav>
          </div>

          {/* Contact */}
          <div>
            <h5 className="font-display font-bold text-sm text-background/90 mb-4">Contact</h5>
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2.5 text-sm">
                <Mail className="h-4 w-4 text-background/70 flex-shrink-0" />
                <a href="mailto:support@aismartstore.co.za" className="hover:text-background transition-colors">support@aismartstore.co.za</a>
              </div>
              <div className="flex items-center gap-2.5 text-sm">
                <MapPin className="h-4 w-4 text-background/70 flex-shrink-0" />
                South Africa
              </div>
            </div>
          </div>
        </div>

        {/* Trust & security band. Sits between the nav-link columns and the
            copyright bar -- previously an empty gap. Every claim here is one
            we can actually stand behind (real SSL, real POPIA/PAIA pages, real
            Yoco integration) rather than a generic badge graphic, and the
            TrustedSite mark (loaded sitewide via index.html) renders its own
            seal independently once the site is verified on their end. */}
        <div className="border-t border-background/[0.06] py-6">
          <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
            {[
              { icon: Lock, label: "256-bit SSL encryption" },
              { icon: ShieldCheck, label: "POPIA & PAIA compliant" },
              { icon: CreditCard, label: "Secure Yoco payments" },
              { icon: BadgeCheck, label: "Verified South African business" },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-2 text-background/70">
                <item.icon className="h-4 w-4 text-background/55 flex-shrink-0" />
                <span className="text-xs font-medium">{item.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-background/[0.06] pt-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
          <p className="text-xs text-background/70">
            © {new Date().getFullYear()} AI Smart Store. All rights reserved. · Est. 19 July 2026
          </p>
          <p className="text-xs text-background/75 inline-flex items-center gap-1.5">
            <Shield className="h-3 w-3" />
            <Link to="/compliance" className="hover:text-background/70 transition-colors">POPIA &amp; PAIA compliant</Link>
            <span className="text-background/20">·</span>
            <span>aismartstore.co.za</span>
          </p>
        </div>
      </div>
    </footer>
  );
};

export default StoreFooter;
