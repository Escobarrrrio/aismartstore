import { Link } from "react-router-dom";
import logo from "@/assets/logo.png";

const StoreFooter = () => {
  return (
    <footer className="border-t border-border/50 bg-card mt-auto">
      <div className="container mx-auto px-4 py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <img src={logo} alt="AI Smart Store" className="h-8 w-8 object-contain" />
              <span className="font-brand font-bold gradient-brand-text">Smart Store</span>
            </div>
            <p className="text-sm text-muted-foreground max-w-xs">
              Your premium destination for smart products, powered by AI.
            </p>
          </div>

          <div>
            <h4 className="font-display font-semibold mb-3 text-foreground">Quick Links</h4>
            <nav className="flex flex-col gap-2">
              <Link to="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Home</Link>
              <Link to="/products" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Products</Link>
            </nav>
          </div>

          <div>
            <h4 className="font-display font-semibold mb-3 text-foreground">Contact</h4>
            <p className="text-sm text-muted-foreground">store.aijobchommie.co.za</p>
          </div>
        </div>

        <div className="border-t border-border/50 mt-8 pt-6 text-center">
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} AI Smart Store. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
};

export default StoreFooter;
