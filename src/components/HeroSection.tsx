import { Link } from "react-router-dom";
import { ArrowRight, Sparkles, Shield, Truck, Headphones, Zap, Star, ChevronRight } from "lucide-react";

const HeroSection = () => {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden">
        {/* Subtle background accent */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.02] via-transparent to-secondary/[0.03]" />
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-gradient-to-bl from-primary/[0.04] to-transparent rounded-full blur-3xl -translate-y-1/2 translate-x-1/4" />

        <div className="container mx-auto px-4 pt-12 pb-16 md:pt-20 md:pb-24 relative">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            {/* Left */}
            <div className="max-w-xl">
              <div className="inline-flex items-center gap-2 bg-primary/[0.06] rounded-full px-4 py-1.5 text-xs font-semibold text-primary mb-6">
                <Sparkles className="h-3.5 w-3.5" />
                South Africa's Premium AI & Tech Store
              </div>

              <h1 className="font-display font-extrabold text-4xl md:text-5xl lg:text-[3.5rem] leading-[1.08] tracking-tight mb-5">
                Enterprise-Grade{" "}
                <span className="gradient-brand-text">Technology</span>
                <br />
                Delivered to You
              </h1>

              <p className="text-muted-foreground text-base md:text-lg leading-relaxed mb-8 max-w-md">
                From AI hardware to networking solutions — curated, competitively priced, and backed by expert support for South African businesses.
              </p>

              <div className="flex gap-3 flex-wrap mb-10">
                <Link to="/products" className="btn-primary px-7 py-3.5 text-sm font-semibold shadow-elevated">
                  Shop Products <ArrowRight className="h-4 w-4" />
                </Link>
                <Link to="/products" className="btn-secondary px-7 py-3.5 text-sm font-semibold">
                  Browse Categories
                </Link>
              </div>

              {/* Trust row */}
              <div className="flex items-center gap-5 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <Shield className="h-4 w-4 text-primary" />
                  <span>Secure Payments</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Truck className="h-4 w-4 text-primary" />
                  <span>SA-Wide Delivery</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Star className="h-4 w-4 text-primary" />
                  <span>Trusted Supplier</span>
                </div>
              </div>
            </div>

            {/* Right — category cards */}
            <div className="hidden lg:grid grid-cols-2 gap-4">
              {[
                { label: "AI & Machine Learning", desc: "GPUs, TPUs, AI accelerators", icon: "🤖", price: "From R2,499" },
                { label: "Networking", desc: "Routers, switches, access points", icon: "🌐", price: "From R1,299" },
                { label: "Computing", desc: "Servers, workstations, storage", icon: "💻", price: "From R4,999" },
                { label: "Software & Licenses", desc: "Enterprise and cloud licenses", icon: "📦", price: "From R499" },
              ].map((card, i) => (
                <Link
                  key={i}
                  to="/products"
                  className={`card-premium p-5 group cursor-pointer ${i === 1 ? 'mt-6' : i === 2 ? '-mt-4' : ''}`}
                >
                  <div className="text-3xl mb-3">{card.icon}</div>
                  <h3 className="font-display font-bold text-sm mb-1 group-hover:text-primary transition-colors">{card.label}</h3>
                  <p className="text-xs text-muted-foreground mb-2">{card.desc}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-primary">{card.price}</span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Trust bar */}
      <section className="border-y border-border bg-muted/50">
        <div className="container mx-auto px-4 py-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {[
              { icon: Truck, title: "Free Shipping", desc: "On orders over R500" },
              { icon: Shield, title: "Secure Checkout", desc: "Yoco payment gateway" },
              { icon: Headphones, title: "AI Support", desc: "24/7 intelligent assistance" },
              { icon: Zap, title: "Fast Delivery", desc: "2-5 business days SA-wide" },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/[0.06] flex items-center justify-center text-primary flex-shrink-0">
                  <item.icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-display font-bold text-sm">{item.title}</p>
                  <p className="text-xs text-muted-foreground">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
};

export default HeroSection;
