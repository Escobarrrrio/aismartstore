import SEO from "@/components/SEO";
import { Link } from "react-router-dom";
import {
  Mail,
  MapPin,
  Phone,
  Clock,
  MessageCircle,
  Award,
  ShieldCheck,
  Wrench,
  Truck,
  CreditCard,
  ArrowRight,
} from "lucide-react";

/**
 * Contact & Support page.
 *
 * Anchors local search signals for "AI store near me" and related queries
 * by publishing the real Gqeberha location, a map, and multiple contact
 * methods. The founder's story and B-BBEE credentials are repeated here as
 * trust signals because this is the page a hesitant shopper is most likely
 * to visit before placing a first order.
 */

const CONTACT_METHODS = [
  {
    icon: Mail,
    label: "Email",
    value: "support@aismartstore.co.za",
    href: "mailto:support@aismartstore.co.za",
    note: "Replies within one business day",
  },
  {
    icon: Phone,
    label: "Phone / WhatsApp",
    value: "+27 (0) 41 001 0245",
    href: "tel:+27410010245",
    note: "Mon–Fri 08:00–17:00 SAST",
  },
  {
    icon: MessageCircle,
    label: "Live chat",
    value: "AI assistant",
    // No href: this card opens the on-page assistant instead of navigating.
    href: null,
    note: "24/7 help via the chat bubble",
  },
];

const TRUST_MARKERS = [
  {
    icon: Award,
    label: "B-BBEE",
    value: "Level 1 EME",
    note: "100% black-owned",
  },
  {
    icon: ShieldCheck,
    label: "Procurement",
    value: "135% recognition",
    note: "Maximum preferential score",
  },
  {
    icon: Truck,
    label: "Supply",
    value: "Authorised distributors",
    note: "Genuine stock, SA-wide",
  },
  {
    icon: CreditCard,
    label: "Payments",
    value: "Secure checkout",
    note: "Yoco & PayFast accepted",
  },
];

const Contact = () => {
  return (
    <div className="flex flex-col">
      <SEO
        title="Contact & Support"
        description="Get in touch with AI Smart Store in Gqeberha. Email, phone, WhatsApp and live chat support for South African AI and technology shoppers."
        path="/contact"
        ogType="website"
        jsonLd={[
          // LocalBusiness is emitted as its own top-level node (not only nested
          // inside ContactPage) so Google can attach it to the entity for
          // "AI Smart Store" directly — nested mainEntity alone is weaker for
          // local "near me" intent. No streetAddress is published: this is an
          // online-first business and a home-office street number would be both
          // inaccurate as a walk-in address and a privacy problem.
          {
            "@context": "https://schema.org",
            "@type": "OnlineStore",
            "@id": "https://aismartstore.co.za/#business",
            name: "AI Smart Store",
            legalName: "AI Smart Store",
            description:
              "South African online retailer of AI-ready laptops, NPU hardware and smart technology, shipping nationwide from Gqeberha, Eastern Cape.",
            founder: { "@type": "Person", name: "Fernando Steyn" },
            url: "https://aismartstore.co.za",
            telephone: "+27-41-001-0245",
            email: "support@aismartstore.co.za",
            priceRange: "R500 - R150000",
            currenciesAccepted: "ZAR",
            paymentAccepted: "Credit Card, Debit Card, EFT, Instant EFT",
            address: {
              "@type": "PostalAddress",
              addressLocality: "Gqeberha",
              addressRegion: "Eastern Cape",
              postalCode: "6001",
              addressCountry: "ZA",
            },
            geo: {
              "@type": "GeoCoordinates",
              latitude: -33.9608,
              longitude: 25.6022,
            },
            areaServed: [
              { "@type": "Country", name: "South Africa" },
              { "@type": "City", name: "Gqeberha" },
              { "@type": "City", name: "Port Elizabeth" },
              { "@type": "AdministrativeArea", name: "Eastern Cape" },
            ],
            openingHoursSpecification: [
              {
                "@type": "OpeningHoursSpecification",
                dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
                opens: "08:00",
                closes: "17:00",
              },
              {
                "@type": "OpeningHoursSpecification",
                dayOfWeek: "Saturday",
                opens: "09:00",
                closes: "13:00",
              },
            ],
            contactPoint: [
              {
                "@type": "ContactPoint",
                contactType: "customer support",
                telephone: "+27-41-001-0245",
                email: "support@aismartstore.co.za",
                areaServed: "ZA",
                availableLanguage: ["en", "af", "xh", "zu"],
              },
              {
                "@type": "ContactPoint",
                contactType: "sales",
                email: "sales@aismartstore.co.za",
                areaServed: "ZA",
                availableLanguage: ["en", "af"],
              },
            ],
            sameAs: ["https://aismartstore.co.za/about"],
          },
          {
            "@context": "https://schema.org",
            "@type": "ContactPage",
            name: "Contact & Support — AI Smart Store",
            url: "https://aismartstore.co.za/contact",
            mainEntity: { "@id": "https://aismartstore.co.za/#business" },
          },
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              {
                "@type": "ListItem",
                position: 1,
                name: "Home",
                item: "https://aismartstore.co.za/",
              },
              {
                "@type": "ListItem",
                position: 2,
                name: "Contact & Support",
                item: "https://aismartstore.co.za/contact",
              },
            ],
          },
        ]}
      />

      {/* Hero / contact cards */}
      <section className="border-b border-border">
        <div className="container mx-auto px-4 py-16 md:py-24">
          <div className="max-w-3xl mb-10">
            <p className="inline-flex items-center gap-2 text-[11px] font-display font-bold uppercase tracking-[0.2em] text-muted-foreground mb-6">
              <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
              Gqeberha · Eastern Cape · South Africa
            </p>
            <h1 className="font-display font-extrabold text-4xl md:text-6xl leading-[1.03] tracking-tight mb-6">
              Contact & Support
            </h1>
            <p className="text-lg md:text-xl leading-relaxed text-muted-foreground">
              We are a South African technology retailer based in Gqeberha,
              Eastern Cape. Reach us by email, phone, WhatsApp or live chat —
              every message is answered by the team that built this store.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            {CONTACT_METHODS.map(({ icon: Icon, label, value, href, note }) => (
              <a
                key={label}
                href={href}
                className="group rounded-2xl border border-border bg-card p-6 hover:border-primary/40 transition-colors"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                    <Icon className="h-5 w-5 text-primary" aria-hidden="true" />
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" aria-hidden="true" />
                </div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                  {label}
                </p>
                <p className="font-display font-bold text-lg text-foreground mb-1">
                  {value}
                </p>
                <p className="text-sm text-muted-foreground">{note}</p>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* Map + address */}
      <section className="border-b border-border bg-muted/30">
        <div className="container mx-auto px-4 py-16 md:py-24">
          <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-stretch">
            <div className="flex flex-col justify-center max-w-xl">
              <p className="text-[11px] font-display font-bold uppercase tracking-[0.2em] text-muted-foreground mb-5">
                Visit us
              </p>
              <h2 className="font-display font-extrabold text-2xl md:text-4xl leading-tight mb-7">
                Based in Gqeberha,
                <br />
                Eastern Cape.
              </h2>
              <div className="space-y-5 text-base md:text-lg leading-relaxed text-muted-foreground">
                <p>
                  AI Smart Store operates from Gqeberha in the Eastern Cape. We
                  do not hide behind a generic support desk — this is a real
                  South African business with a real local presence.
                </p>
                <address className="not-italic rounded-2xl border border-border bg-card p-6 text-foreground">
                  <p className="font-display font-bold text-lg mb-1">
                    AI Smart Store
                  </p>
                  <p>Gqeberha</p>
                  <p>Eastern Cape</p>
                  <p className="mt-1">South Africa</p>
                </address>
                <p className="inline-flex items-center gap-2 text-sm text-foreground font-medium">
                  <Clock className="h-4 w-4 text-primary" aria-hidden="true" />
                  Support hours: Monday–Friday, 08:00–17:00 SAST
                </p>
              </div>
            </div>

            <figure className="relative overflow-hidden rounded-3xl border border-border bg-card aspect-[4/3] lg:aspect-auto lg:min-h-[420px]">
              <iframe
                title="AI Smart Store location — Gqeberha, Eastern Cape"
                src="https://www.openstreetmap.org/export/embed.html?bbox=25.520%2C-33.970%2C25.660%2C-33.830&layer=mapnik&marker=-33.900%2C25.590"
                className="absolute inset-0 h-full w-full border-0"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                aria-label="Map showing Gqeberha, Eastern Cape"
              />
              <figcaption className="sr-only">
                Map showing Gqeberha, Eastern Cape, South Africa, where AI
                Smart Store is based.
              </figcaption>
            </figure>
          </div>
        </div>
      </section>

      {/* Founder story */}
      <section className="border-b border-border">
        <div className="container mx-auto px-4 py-16 md:py-24 max-w-4xl">
          <div className="flex items-center gap-3 mb-6">
            <Wrench className="h-5 w-5 text-primary" aria-hidden="true" />
            <p className="text-[11px] font-display font-bold uppercase tracking-[0.2em] text-muted-foreground">
              Why you can trust us
            </p>
          </div>

          <h2 className="font-display font-extrabold text-2xl md:text-4xl leading-tight mb-8">
            Built from nothing, with nothing.
          </h2>

          <div className="space-y-6 text-base md:text-lg leading-relaxed text-muted-foreground max-w-3xl">
            <p>
              AI Smart Store was coded from scratch by founder Fernando Steyn —
              self-taught, in Gqeberha, after a welding accident, a
              bereavement and a house fire. What remained was one laptop, one
              internet connection, and a refusal to quit.
            </p>
            <p>
              He completed freeCodeCamp module after module until he had built
              something that did not exist before: a fully functional South
              African technology e-commerce platform, with real payment
              gateways, real stock feeds from authorised distributors, and a
              real order management flow.
            </p>
            <p className="text-foreground font-medium">
              Every order placed here is fulfilled by a South African business
              run by someone who lives in the community it serves. Buying from
              AI Smart Store puts money into the Eastern Cape economy.
            </p>
          </div>

          <div className="mt-10">
            <Link
              to="/about"
              className="inline-flex items-center gap-2 rounded-full border border-border px-6 py-3 text-sm font-semibold hover:border-foreground/30 transition-colors"
            >
              Read the full story <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Trust markers */}
      <section className="border-b border-border bg-muted/30">
        <div className="container mx-auto px-4 py-16 max-w-5xl">
          <h2 className="font-display font-extrabold text-2xl md:text-3xl mb-3">
            Trust signals
          </h2>
          <p className="text-muted-foreground mb-10 max-w-2xl">
            We back every claim with real credentials and real supply-chain
            relationships.
          </p>

          <dl className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {TRUST_MARKERS.map(({ icon: Icon, label, value, note }) => (
              <div key={label} className="rounded-2xl border border-border bg-card p-6">
                <Icon className="h-5 w-5 text-primary mb-4" aria-hidden="true" />
                <dt className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  {label}
                </dt>
                <dd className="font-display font-extrabold text-lg mt-1.5 leading-tight">
                  {value}
                </dd>
                <dd className="text-xs text-muted-foreground mt-1">{note}</dd>
              </div>
            ))}
          </dl>

          <p className="text-xs text-muted-foreground mt-8">
            Registration 2025/599261/07 · CSD MAAA1656325 · B-BBEE Level 1 EME ·
            Proudly South African
          </p>
        </div>
      </section>

      {/* Quick support links */}
      <section>
        <div className="container mx-auto px-4 py-16 md:py-24 max-w-3xl text-center">
          <p className="font-display font-extrabold text-2xl md:text-3xl leading-snug mb-6">
            Need help before you order?
          </p>
          <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
            Most questions are answered on our support pages. If not, use the
            chat bubble or email us directly.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/shipping-returns"
              className="inline-flex items-center gap-2 rounded-full border border-border px-6 py-3 text-sm font-semibold hover:border-foreground/30 transition-colors"
            >
              Shipping & Returns
            </Link>
            <Link
              to="/terms"
              className="inline-flex items-center gap-2 rounded-full border border-border px-6 py-3 text-sm font-semibold hover:border-foreground/30 transition-colors"
            >
              Terms of Service
            </Link>
            <Link
              to="/compliance"
              className="inline-flex items-center gap-2 rounded-full border border-border px-6 py-3 text-sm font-semibold hover:border-foreground/30 transition-colors"
            >
              POPIA & PAIA
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Contact;
