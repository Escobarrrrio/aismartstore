import { Link } from "react-router-dom";
import { ArrowRight, Sparkles, Truck, Shield, Headphones, Zap } from "lucide-react";

const HeroSection = () => {
  return (
    <>
      <section className="container mx-auto px-4 py-12 md:py-20">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
          {/* Left */}
          <div className="animate-fade-in">
            <div className="inline-flex items-center gap-2 bg-muted border border-border rounded-full px-3 py-1 text-xs font-medium text-muted-foreground mb-5">
              <span className="w-1.5 h-1.5 rounded-full gradient-brand shadow-sm" />
              AI-Powered Tech Store
            </div>

            <h1 className="font-display font-extrabold text-4xl md:text-5xl lg:text-[3.2rem] leading-[1.1] mb-4">
              Next-Gen{" "}
              <span className="gradient-brand-text">Tech & AI</span>
              {" "}Products
            </h1>

            <p className="text-muted-foreground text-base leading-relaxed mb-7 max-w-lg">
              Discover premium tech products at smart prices. From AI tools to hardware — curated for South Africa.
            </p>

            <div className="flex gap-3 flex-wrap">
              <Link
                to="/products"
                className="btn-primary px-6 py-3 text-sm shadow-elevated"
              >
                Shop Now <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                to="/products"
                className="btn-outline px-6 py-3 text-sm"
              >
                <Sparkles className="h-4 w-4" /> Browse Categories
              </Link>
            </div>
          </div>

          {/* Right — floating cards */}
          <div className="hidden md:grid grid-cols-2 gap-3">
            {[
              { label: "AI Hardware", price: "From R2,499", delay: "0s" },
              { label: "Smart Devices", price: "From R899", delay: "-1s" },
              { label: "Networking", price: "From R1,299", delay: "-2s" },
              { label: "Software", price: "From R499", delay: "-3s" },
            ].map((card, i) => (
              <div
                key={i}
                className={`bg-muted border border-border rounded-xl overflow-hidden animate-float ${i === 1 ? 'mt-5' : i === 2 ? '-mt-3' : i === 3 ? 'mt-2' : ''}`}
                style={{ animationDelay: card.delay }}
              >
                <div className="h-28 bg-gradient-to-br from-muted to-accent" />
                <div className="p-3">
                  <p className="text-xs font-display font-semibold">{card.label}</p>
                  <span className="text-xs text-secondary font-bold">{card.price}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Stats bar */}
      <div className="bg-muted border-y border-border">
        <div className="container mx-auto px-4 py-4 flex flex-wrap justify-center gap-6 md:gap-10">
          {[
            { icon: Truck, value: "Free Shipping", label: "Orders over R500" },
            { icon: Shield, value: "Secure Pay", label: "Yoco Payments" },
            { icon: Headphones, value: "AI Support", label: "24/7 Chatbot" },
            { icon: Zap, value: "Fast Delivery", label: "2-5 Business Days" },
          ].map((stat, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-secondary/10 flex items-center justify-center text-secondary flex-shrink-0">
                <stat.icon className="h-5 w-5" />
              </div>
              <div>
                <strong className="font-display font-extrabold text-sm gradient-brand-text block leading-tight">
                  {stat.value}
                </strong>
                <span className="text-xs text-muted-foreground">{stat.label}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
};

export default HeroSection;
