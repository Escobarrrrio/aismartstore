import { useProducts } from "@/contexts/ProductContext";
import ProductCard from "@/components/ProductCard";
import HeroSection from "@/components/HeroSection";
import { Package, ArrowRight, Cpu, Globe, Server, Code, MessageCircle, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";

const Index = () => {
  const { products, loading } = useProducts();
  const featured = products.slice(0, 8);

  return (
    <div className="flex flex-col">
      <HeroSection />

      {/* Categories Section */}
      <section className="section-padding">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-display font-extrabold tracking-tight mb-3">
              Shop by Category
            </h2>
            <p className="text-muted-foreground max-w-md mx-auto">
              Find exactly what you need across our curated technology categories
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { icon: Cpu, label: "AI & Hardware", count: "50+ products", color: "bg-primary/[0.06] text-primary" },
              { icon: Globe, label: "Networking", count: "30+ products", color: "bg-secondary/[0.06] text-secondary" },
              { icon: Server, label: "Computing", count: "40+ products", color: "bg-[hsl(160,84%,39%)]/[0.06] text-[hsl(160,84%,39%)]" },
              { icon: Code, label: "Software", count: "20+ products", color: "bg-[hsl(38,92%,50%)]/[0.06] text-[hsl(38,92%,50%)]" },
            ].map((cat, i) => (
              <Link
                key={i}
                to="/products"
                className="card-premium p-6 text-center group"
              >
                <div className={`w-14 h-14 rounded-2xl ${cat.color} flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform duration-300`}>
                  <cat.icon className="h-7 w-7" />
                </div>
                <h3 className="font-display font-bold text-sm mb-1">{cat.label}</h3>
                <p className="text-xs text-muted-foreground">{cat.count}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Featured Products */}
      <section className="section-padding bg-muted/30">
        <div className="container mx-auto px-4">
          <div className="flex items-end justify-between mb-10">
            <div>
              <h2 className="text-3xl md:text-4xl font-display font-extrabold tracking-tight mb-2">
                Featured Products
              </h2>
              <p className="text-muted-foreground">Hand-picked tech at competitive prices</p>
            </div>
            <Link to="/products" className="hidden md:flex items-center gap-2 text-sm font-semibold text-primary hover:underline">
              View All <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="card-flat overflow-hidden animate-pulse">
                  <div className="aspect-[4/3] bg-muted" />
                  <div className="p-4 space-y-3">
                    <div className="h-3 bg-muted rounded w-1/4" />
                    <div className="h-4 bg-muted rounded w-3/4" />
                    <div className="h-3 bg-muted rounded w-full" />
                    <div className="flex justify-between items-center pt-2">
                      <div className="h-5 bg-muted rounded w-20" />
                      <div className="h-10 bg-muted rounded-full w-20" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : featured.length === 0 ? (
            <div className="text-center py-20 card-flat">
              <Package className="h-14 w-14 text-muted-foreground/30 mx-auto mb-4" />
              <p className="text-muted-foreground text-lg font-display font-semibold mb-1">No products yet</p>
              <p className="text-sm text-muted-foreground">
                Products will appear here once added from the Admin panel
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {featured.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          )}

          <div className="md:hidden text-center mt-8">
            <Link to="/products" className="btn-secondary px-6 py-3 text-sm">
              View All Products <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Benefits Section */}
      <section className="section-padding">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-display font-extrabold tracking-tight mb-3">
              Why Choose Smart Store?
            </h2>
            <p className="text-muted-foreground max-w-lg mx-auto">
              Built for South African businesses that need reliable technology partners
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                title: "Authorised Distributor",
                desc: "Direct partnerships with top-tier technology brands ensure genuine products and competitive pricing.",
                icon: "🏢",
              },
              {
                title: "AI-Powered Support",
                desc: "Our intelligent chatbot helps you find the right product, check compatibility, and get instant answers.",
                icon: "🤖",
              },
              {
                title: "Business-Ready",
                desc: "Bulk ordering, invoice support, and dedicated account management for enterprise customers.",
                icon: "📊",
              },
            ].map((benefit, i) => (
              <div key={i} className="card-flat p-8 text-center">
                <div className="text-4xl mb-4">{benefit.icon}</div>
                <h3 className="font-display font-bold text-lg mb-2">{benefit.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{benefit.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* AI Assistant CTA */}
      <section className="section-padding-sm">
        <div className="container mx-auto px-4">
          <div className="relative overflow-hidden rounded-3xl gradient-brand p-8 md:p-12">
            <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />
            <div className="relative grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
              <div>
                <div className="inline-flex items-center gap-2 bg-white/20 rounded-full px-4 py-1.5 text-xs font-semibold text-white mb-4">
                  <MessageCircle className="h-3.5 w-3.5" />
                  AI Assistant
                </div>
                <h2 className="text-2xl md:text-3xl font-display font-extrabold text-white mb-3">
                  Need Help Finding the Right Product?
                </h2>
                <p className="text-white/70 text-sm leading-relaxed mb-6 max-w-md">
                  Our AI assistant can help you compare products, check specifications, find compatibility info, and answer your tech questions — instantly.
                </p>
                <p className="text-white/50 text-xs">
                  Click the chat icon in the bottom right to get started →
                </p>
              </div>
              <div className="hidden md:flex justify-center">
                <div className="w-48 h-48 rounded-full bg-white/10 flex items-center justify-center">
                  <MessageCircle className="h-20 w-20 text-white/30" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Brands Section */}
      <section className="section-padding-sm border-t border-border">
        <div className="container mx-auto px-4">
          <p className="text-center text-xs text-muted-foreground uppercase tracking-widest font-semibold mb-8">
            Trusted Technology Brands
          </p>
          <div className="flex flex-wrap justify-center items-center gap-8 md:gap-12">
            {["Dell", "HP", "Lenovo", "Cisco", "Microsoft", "Intel", "AMD", "NVIDIA"].map((brand) => (
              <span
                key={brand}
                className="font-display font-bold text-lg text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors cursor-default"
              >
                {brand}
              </span>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
};

export default Index;
