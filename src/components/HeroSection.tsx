import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, Sparkles, Shield, Truck, Headphones, Zap, Star, ChevronRight, Bot, Globe, Monitor, Package } from "lucide-react";

const HeroSection = () => {
  const { t } = useTranslation();

  const heroCards = [
    { key: "ai", Icon: Bot, price: "R2,499" },
    { key: "networking", Icon: Globe, price: "R1,299" },
    { key: "computing", Icon: Monitor, price: "R4,999" },
    { key: "software", Icon: Package, price: "R499" },
  ] as const;

  const featureBar = [
    { key: "shipping", icon: Truck },
    { key: "checkout", icon: Shield },
    { key: "support", icon: Headphones },
    { key: "delivery", icon: Zap },
  ] as const;

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
                {t("home.heroBadge")}
              </div>

              <h1 className="font-display font-extrabold text-4xl md:text-5xl lg:text-[3.5rem] leading-[1.08] tracking-tight mb-5">
                {t("home.heroTitle1")}{" "}
                <span className="shimmer-text">{t("home.heroTitle2")}</span>
                <br />
                {t("home.heroTitle3")}
              </h1>

              <p className="text-muted-foreground text-base md:text-lg leading-relaxed mb-8 max-w-md">
                {t("home.heroSubtitle")}
              </p>

              <div className="flex gap-3 flex-wrap mb-10">
                <Link to="/products" className="btn-primary px-7 py-3.5 text-sm font-semibold shadow-elevated">
                  {t("home.shopNow")} <ArrowRight className="h-4 w-4" />
                </Link>
                <Link to="/products" className="btn-secondary px-7 py-3.5 text-sm font-semibold">
                  {t("home.browseCategories")}
                </Link>
              </div>

              {/* Trust row */}
              <div className="flex items-center gap-5 text-xs text-muted-foreground flex-wrap">
                <div className="flex items-center gap-1.5">
                  <Shield className="h-4 w-4 text-primary" />
                  <span>{t("home.trustRow.secure")}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Truck className="h-4 w-4 text-primary" />
                  <span>{t("home.trustRow.delivery")}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Star className="h-4 w-4 text-primary" />
                  <span>{t("home.trustRow.trusted")}</span>
                </div>
              </div>
            </div>

            {/* Right — category cards */}
            <div className="hidden lg:grid grid-cols-2 gap-4">
              {heroCards.map((card, i) => (
                <Link
                  key={card.key}
                  to="/products"
                  className={`card-premium p-5 group cursor-pointer ${i === 1 ? 'mt-6' : i === 2 ? '-mt-4' : ''}`}
                >
                  <div className="w-10 h-10 rounded-xl bg-primary/[0.06] text-primary flex items-center justify-center mb-3">
                    <card.Icon className="h-5 w-5" />
                  </div>
                  <h3 className="font-display font-bold text-sm mb-1 group-hover:text-primary transition-colors">
                    {t(`home.heroCards.${card.key}.label`)}
                  </h3>
                  <p className="text-xs text-muted-foreground mb-2">
                    {t(`home.heroCards.${card.key}.desc`)}
                  </p>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-primary">
                      {t("home.fromPrice")} {card.price}
                    </span>
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
            {featureBar.map((item) => (
              <div key={item.key} className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/[0.06] flex items-center justify-center text-primary flex-shrink-0">
                  <item.icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-display font-bold text-sm">{t(`home.featureBar.${item.key}.title`)}</p>
                  <p className="text-xs text-muted-foreground">{t(`home.featureBar.${item.key}.desc`)}</p>
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
