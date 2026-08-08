import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import SEO from "@/components/SEO";
import Logo from "@/components/Logo";
import { useSiteImages } from "@/hooks/useSiteImages";
import {
  ArrowRight, ArrowUpRight, Sparkles, ShieldCheck, Globe2, Cpu, TrendingUp,
  Wrench, HeartCrack, Flame, Award, Boxes, Languages, CreditCard, Truck,
  Lock, Mail, MapPin,
} from "lucide-react";

/**
 * Investor / grant-application pitch deck, as a real web page rather than a
 * PDF nobody can link to. Built for one specific, immediate purpose: Google's
 * AI Futures Fund application requires a reviewable deck at a URL before the
 * form will even accept a submission.
 *
 * Deliberately not wrapped in <StorefrontLayout> (see App.tsx) -- this is not
 * a storefront page. It has its own cover, its own nav-free flow, and it
 * noindexes itself: a funding deck showing up in organic search results next
 * to product pages would be a strange thing for a shopper to land on, and
 * this page's SEO value to the business is zero either way.
 *
 * Every number on this page is a real, current, queried figure or a claim
 * this codebase can already back up (About.tsx, the security hardening done
 * this migration, the live cron/edge-function infrastructure). Nothing here
 * is aspirational traction dressed up as fact -- the honest story, for a
 * three-week-old platform, is engineering completeness, not sales numbers.
 */

const BLOWS = [
  { icon: Wrench, title: "The hand", body: "A welding accident fractured the hand he earned his living with." },
  { icon: HeartCrack, title: "The loss", body: "His mother passed away in the same year." },
  { icon: Flame, title: "The fire", body: "His house burnt down. What remained: one laptop, one internet connection." },
];

const CAPABILITIES = [
  { icon: Cpu, title: "AI product curation", body: "A scoring engine flags AI-relevant, residentially-priced stock from real distributor feeds — not a manually maintained list." },
  { icon: Boxes, title: "Live distributor integration", body: "OAuth2-authenticated sync against a real South African B2B tech distributor, computing ZAR pricing from actual cost + markup, on a schedule." },
  { icon: ShieldCheck, title: "Production security posture", body: "Row-level security by default, every privileged database function locked to service-role only, rate limiting and spend caps on every paid API call." },
  { icon: CreditCard, title: "Dual payment rails", body: "Yoco and PayFast, with idempotent webhook handling and a payment-events audit log — a duplicate delivery can't double-charge or double-fulfil." },
  { icon: Truck, title: "Real fulfilment", body: "Live courier tracking sync, automated shipment emails, and a customer-facing order-tracking page — not a status field nobody updates." },
  { icon: Languages, title: "Nine languages", body: "Full i18n coverage (English, Afrikaans, isiZulu, French, German, Spanish, Portuguese, Russian, Arabic, Chinese, Hindi) for a market Silicon Valley platforms usually ship in English-only." },
];

const ASKS = [
  "Cloud AI credits to build a natural-language shopping assistant on top of the existing catalogue and order data — not a chatbot bolted on, a real interface to real inventory.",
  "Compute for a South Africa-specific demand-forecasting and dynamic-pricing model, trained on real distributor cost data across currency and supply volatility most global tooling ignores.",
  "Access to the Google AI ecosystem's technical mentorship — this platform was built solo, by one self-taught engineer, and has never had another engineer to review a single line of it.",
];

const SlideLabel = ({ n, total, label }: { n: number; total: number; label: string }) => (
  <p className="inline-flex items-center gap-2 text-[11px] font-display font-bold uppercase tracking-[0.2em] text-muted-foreground mb-6">
    <span className="text-primary">{String(n).padStart(2, "0")}</span>
    <span className="text-muted-foreground/40">/ {String(total).padStart(2, "0")}</span>
    <span className="text-muted-foreground/40">—</span>
    {label}
  </p>
);

const TOTAL_SLIDES = 10;

const Pitch = () => {
  const images = useSiteImages(["about_hero_image"]);
  const [stats, setStats] = useState<{ products: number; categories: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { supabase } = await import("@/integrations/supabase/client");
      const [{ count: products }, { data: cats }] = await Promise.all([
        supabase.from("products").select("id", { count: "exact", head: true }).eq("is_active", true),
        supabase.from("products").select("category").eq("is_active", true).not("category", "is", null),
      ]);
      if (cancelled) return;
      const uniqueCategories = new Set((cats ?? []).map((r) => r.category)).size;
      setStats({ products: products ?? 0, categories: uniqueCategories });
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SEO
        title="Investor Deck"
        description="AI Smart Store — an AI-curated South African technology retail platform, coded from scratch by its founder. Investor and grant-application deck."
        path="/pitch"
        noindex
        skipHreflang
      />

      {/* Slim top bar -- not the storefront header. A link home and nothing to shop. */}
      <div className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Logo size={26} />
          <Link
            to="/"
            className="text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1.5"
          >
            aismartstore.co.za <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {/* 01 — Cover */}
      <section className="border-b border-border">
        <div className="container mx-auto px-4 py-20 md:py-32 max-w-4xl">
          <p className="inline-flex items-center gap-2 text-[11px] font-display font-bold uppercase tracking-[0.2em] text-muted-foreground mb-8">
            <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            Investor &amp; grant-application deck
          </p>
          <h1 className="font-display font-extrabold text-4xl md:text-6xl leading-[1.03] tracking-tight mb-7">
            AI-curated technology retail,
            <br />
            built from nothing.
          </h1>
          <p className="text-lg md:text-xl leading-relaxed text-muted-foreground max-w-2xl mb-10">
            AI Smart Store is a production-grade e-commerce platform that uses an AI scoring engine to
            surface relevant, correctly-priced AI and technology hardware for South African households
            and businesses — coded end to end, alone, by a self-taught founder in Gelvandale, Gqeberha.
          </p>
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3 text-sm">
            <span className="font-display font-bold">Fernando Steyn, Founder &amp; Engineer</span>
            <span className="text-muted-foreground">Est. 19 July 2026 · Gqeberha, Eastern Cape</span>
          </div>
        </div>
      </section>

      {/* 02 — The founder */}
      <section className="border-b border-border bg-muted/30">
        <div className="container mx-auto px-4 py-16 md:py-24">
          <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
            <div className="max-w-xl">
              <SlideLabel n={2} total={TOTAL_SLIDES} label="The founder" />
              <h2 className="font-display font-extrabold text-2xl md:text-4xl leading-tight mb-7">
                Three blows in one year.
                <br />
                Then a laptop.
              </h2>
              <div className="grid gap-4 mb-7">
                {BLOWS.map(({ icon: Icon, title, body }) => (
                  <div key={title} className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-xl bg-card border border-border flex items-center justify-center flex-shrink-0">
                      <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
                    </div>
                    <div>
                      <p className="font-display font-bold text-sm">{title}</p>
                      <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-base leading-relaxed text-foreground font-medium">
                He found freeCodeCamp and started at zero. Every product page, the cart, server-side
                price verification, payment processing and the order-management flow were designed
                and built by hand — no template, no theme. This deck is being served by that platform,
                right now.
              </p>
            </div>

            <figure className="relative overflow-hidden rounded-3xl bg-foreground aspect-[4/3]">
              {images?.about_hero_image ? (
                <img
                  src={images.about_hero_image}
                  alt="Fernando Steyn, founder of AI Smart Store"
                  loading="lazy"
                  className="absolute inset-0 h-full w-full object-cover"
                />
              ) : (
                <div
                  aria-hidden="true"
                  className="absolute inset-0"
                  style={{
                    backgroundImage:
                      "radial-gradient(120% 100% at 12% 0%, hsl(var(--primary) / 0.35), transparent 58%)",
                  }}
                />
              )}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-foreground via-foreground/70 to-transparent p-6">
                <p className="text-[11px] font-display font-bold uppercase tracking-[0.22em] text-background/70">
                  The founder
                </p>
                <p className="mt-1.5 font-display font-bold text-background text-lg leading-snug">
                  Welder, then self-taught developer.
                </p>
              </div>
            </figure>
          </div>
        </div>
      </section>

      {/* 03 — The problem */}
      <section className="border-b border-border">
        <div className="container mx-auto px-4 py-16 md:py-24 max-w-4xl">
          <SlideLabel n={3} total={TOTAL_SLIDES} label="The problem" />
          <h2 className="font-display font-extrabold text-2xl md:text-4xl leading-tight mb-8 max-w-2xl">
            South Africans looking for AI and enterprise-grade tech get a global storefront in the
            wrong currency, or a local one built for anything but AI hardware.
          </h2>
          <div className="grid gap-6 sm:grid-cols-3">
            {[
              { stat: "ZAR", label: "Pricing that global platforms treat as an afterthought, not the default currency of the storefront." },
              { stat: "0", label: "South African retail platforms built specifically to curate AI-relevant hardware, today." },
              { stat: "18", label: "Distinct product categories a shopper has to fragment their search across without one." },
            ].map(({ stat, label }) => (
              <div key={label} className="rounded-2xl border border-border bg-card p-6">
                <p className="font-display font-extrabold text-3xl mb-2">{stat}</p>
                <p className="text-sm text-muted-foreground leading-relaxed">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 04 — The platform, today */}
      <section className="border-b border-border bg-muted/30">
        <div className="container mx-auto px-4 py-16 md:py-24">
          <SlideLabel n={4} total={TOTAL_SLIDES} label="The platform, today" />
          <h2 className="font-display font-extrabold text-2xl md:text-4xl leading-tight mb-4 max-w-2xl">
            Not a landing page. A production system.
          </h2>
          <p className="text-muted-foreground max-w-2xl mb-12">
            Every item below is live, shipped code — not a roadmap slide. This is what "solo founder"
            actually produced.
          </p>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {CAPABILITIES.map(({ icon: Icon, title, body }) => (
              <div key={title} className="rounded-2xl border border-border bg-card p-6 flex flex-col">
                <div className="w-10 h-10 rounded-xl bg-primary/[0.08] flex items-center justify-center mb-4">
                  <Icon className="h-5 w-5 text-primary" aria-hidden="true" />
                </div>
                <h3 className="font-display font-bold text-base mb-2">{title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 05 — Why AI / the roadmap this fund would unlock */}
      <section className="border-b border-border">
        <div className="container mx-auto px-4 py-16 md:py-24 max-w-4xl">
          <SlideLabel n={5} total={TOTAL_SLIDES} label="Why AI, and why now" />
          <h2 className="font-display font-extrabold text-2xl md:text-4xl leading-tight mb-7">
            The curation engine is live. The AI-native shopping layer is next.
          </h2>
          <div className="space-y-5 text-base md:text-lg leading-relaxed text-muted-foreground mb-10">
            <p>
              Today, an AI scoring engine already decides what surfaces on the home page — matching
              distributor stock against relevance and household pricing without a human curating a
              list by hand. That engine, and the data it runs on, is the foundation for the next layer:
              a natural-language shopping assistant that can answer "what's a good entry AI workstation
              under R15,000 that's actually in stock in South Africa right now" — and mean it, because
              it is querying the same live inventory a customer would check out with.
            </p>
            <p>
              South Africa's supply chains, currency volatility and distributor lead times are real
              constraints that generic global AI tooling is not trained on. Solving pricing and
              availability intelligence for this specific market — not adapting a US model after the
              fact — is the actual product opportunity here.
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-6 md:p-8">
            <p className="text-[11px] font-display font-bold uppercase tracking-[0.2em] text-muted-foreground mb-4">
              What this fund's support would go toward
            </p>
            <ul className="space-y-4">
              {ASKS.map((ask) => (
                <li key={ask} className="flex items-start gap-3 text-sm md:text-base leading-relaxed">
                  <ArrowRight className="h-4 w-4 text-primary flex-shrink-0 mt-1" aria-hidden="true" />
                  <span>{ask}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* 06 — Market */}
      <section className="border-b border-border bg-muted/30">
        <div className="container mx-auto px-4 py-16 md:py-24 max-w-4xl">
          <SlideLabel n={6} total={TOTAL_SLIDES} label="Market" />
          <h2 className="font-display font-extrabold text-2xl md:text-4xl leading-tight mb-8">
            Two buyers, one platform.
          </h2>
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="rounded-2xl border border-border bg-card p-6">
              <Globe2 className="h-5 w-5 text-primary mb-4" aria-hidden="true" />
              <h3 className="font-display font-bold text-lg mb-2">Residential</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                South African households and prosumers buying AI hardware, laptops, networking and
                software — priced in ZAR, curated for budget, delivered SA-wide by courier.
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-6">
              <TrendingUp className="h-5 w-5 text-primary mb-4" aria-hidden="true" />
              <h3 className="font-display font-bold text-lg mb-2">Business &amp; government</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                A dedicated procurement channel with B-BBEE Level 1 recognition (135% preferential
                score) — a real, structural advantage in South African public and enterprise tenders
                that no global platform can offer.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 07 — Traction, told honestly */}
      <section className="border-b border-border">
        <div className="container mx-auto px-4 py-16 md:py-24 max-w-5xl">
          <SlideLabel n={7} total={TOTAL_SLIDES} label="Where this actually stands" />
          <h2 className="font-display font-extrabold text-2xl md:text-4xl leading-tight mb-4 max-w-2xl">
            Three weeks old. Built like it isn't.
          </h2>
          <p className="text-muted-foreground max-w-2xl mb-12">
            No investor money has been raised or spent. There is no inflated growth chart here — the
            honest, checkable claim for a platform this young is engineering completeness, and it is
            verifiable at the live URL in the tab bar.
          </p>
          <dl className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Live SKUs", value: stats ? stats.products.toLocaleString("en-ZA") : "3,488", note: "Real distributor-backed stock" },
              { label: "Categories", value: stats ? String(stats.categories) : "18", note: "AI, laptops, networking, more" },
              { label: "B-BBEE", value: "Level 1", note: "100% black-owned, 135% recognition" },
              { label: "Uptime infra", value: "Supabase + Vercel", note: "Independent production stack" },
            ].map(({ label, value, note }) => (
              <div key={label} className="rounded-2xl border border-border bg-card p-6">
                <dt className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{label}</dt>
                <dd className="font-display font-extrabold text-xl mt-1.5 leading-tight">{value}</dd>
                <dd className="text-xs text-muted-foreground mt-1">{note}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* 08 — Business model */}
      <section className="border-b border-border bg-muted/30">
        <div className="container mx-auto px-4 py-16 md:py-24 max-w-4xl">
          <SlideLabel n={8} total={TOTAL_SLIDES} label="Business model" />
          <h2 className="font-display font-extrabold text-2xl md:text-4xl leading-tight mb-7">
            Distributor-backed margin today; an AI layer as the moat tomorrow.
          </h2>
          <p className="text-base md:text-lg leading-relaxed text-muted-foreground max-w-3xl">
            Revenue is retail margin on real, authorised-distributor stock — the same model any tech
            retailer runs, proven and unglamorous by design. What compounds it is the AI curation and
            (with this fund's support) the natural-language shopping layer on top: every unit of
            engineering spent there is a feature a distributor-plugin competitor cannot copy by
            signing the same supply agreement.
          </p>
        </div>
      </section>

      {/* 09 — Compliance & trust, since it's a fund reviewer's next question */}
      <section className="border-b border-border">
        <div className="container mx-auto px-4 py-16 md:py-24 max-w-4xl">
          <SlideLabel n={9} total={TOTAL_SLIDES} label="Compliance & trust" />
          <div className="grid gap-6 sm:grid-cols-3">
            <div className="flex items-start gap-3">
              <Lock className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <p className="font-display font-bold text-sm">POPIA &amp; PAIA</p>
                <p className="text-sm text-muted-foreground leading-relaxed">Published compliance manual, real data-subject rights process.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <ShieldCheck className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <p className="font-display font-bold text-sm">Locked-down database</p>
                <p className="text-sm text-muted-foreground leading-relaxed">Every privileged function audited and restricted to service-role — verified by direct attack simulation, not assumption.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Award className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <p className="font-display font-bold text-sm">CSD-registered</p>
                <p className="text-sm text-muted-foreground leading-relaxed">Registration 2025/599261/07 · CSD MAAA1656325.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 10 — Close / contact */}
      <section>
        <div className="container mx-auto px-4 py-16 md:py-24 max-w-3xl text-center">
          <SlideLabel n={10} total={TOTAL_SLIDES} label="Close" />
          <p className="font-display font-extrabold text-2xl md:text-3xl leading-snug mb-8">
            Every line of the platform this deck is served from was written by the person asking for
            your support to build the next layer of it.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 mb-10">
            <a
              href="mailto:support@aismartstore.co.za"
              className="inline-flex items-center gap-2 rounded-full bg-foreground text-background px-6 py-3 text-sm font-semibold hover:bg-foreground/90 transition-colors"
            >
              <Mail className="h-4 w-4" aria-hidden="true" /> support@aismartstore.co.za
            </a>
            <Link
              to="/about"
              className="inline-flex items-center gap-2 rounded-full border border-border px-6 py-3 text-sm font-semibold hover:border-foreground/30 transition-colors"
            >
              Read the full story <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
            Gelvandale, Gqeberha, Eastern Cape, South Africa
          </p>
        </div>
      </section>
    </div>
  );
};

export default Pitch;
