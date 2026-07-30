import SEO from "@/components/SEO";
import { Link } from "react-router-dom";
import { ArrowRight, Flame, HeartCrack, Wrench, Laptop, ShieldCheck, Award } from "lucide-react";

/**
 * The founder's story.
 *
 * Written plainly on purpose. Three things happened to Fernando Steyn in
 * quick succession, and the temptation with a story like this is to reach for
 * inspirational-poster language. That would cheapen it. The facts are stronger
 * than any adjective available, so the facts carry the page and the sentences
 * stay out of their way.
 *
 * Everything here is drawn from the company profile document. Nothing is
 * embellished, and no claim appears that the business cannot stand behind --
 * this page sits one click from a B-BBEE affidavit and a CSD number.
 */

const BLOWS = [
  {
    n: "01",
    icon: Wrench,
    title: "The Hand",
    body:
      "A welding accident fractured his right hand — the hand he earned his living with. The grinder stopped. The arc went cold. The income disappeared overnight.",
  },
  {
    n: "02",
    icon: HeartCrack,
    title: "The Loss",
    body:
      "His mother passed away. The kind of grief that rewires a person. That sits on your chest at 2am, when the laptop screen is the only light in the room.",
  },
  {
    n: "03",
    icon: Flame,
    title: "The Fire",
    body:
      "His house burnt down. He lost almost everything. What remained: one laptop, one internet connection, and a character that refused to accept that this was the end.",
  },
];

const BUILT = [
  "HTML", "CSS", "JavaScript", "Responsive design", "APIs",
  "Databases", "E-commerce architecture", "Payment gateways", "Security layers",
];

const About = () => (
  <div className="flex flex-col">
    <SEO
      title="Our Story"
      description="AI Smart Store was coded from scratch by founder Fernando Steyn — self-taught, after a welding accident, a bereavement and a house fire. A 100% black-owned, B-BBEE Level 1 South African technology retailer."
      path="/about"
      jsonLd={[
        {
          "@context": "https://schema.org",
          "@type": "AboutPage",
          name: "About AI Smart Store",
          mainEntity: {
            "@type": "Organization",
            name: "AI Smart Store",
            founder: { "@type": "Person", name: "Fernando Steyn" },
            foundingDate: "2025",
            areaServed: "ZA",
            description:
              "South African consumer and B2B technology e-commerce platform, custom-built by its founder.",
          },
        },
      ]}
    />

    {/* Opening statement */}
    <section className="border-b border-border">
      <div className="container mx-auto px-4 py-16 md:py-24 max-w-4xl">
        <p className="text-[11px] font-display font-bold uppercase tracking-[0.2em] text-muted-foreground mb-5">
          Our Story
        </p>
        <h1 className="font-display font-extrabold text-3xl md:text-5xl leading-[1.1] mb-8">
          Built from nothing,
          <br />
          with nothing.
        </h1>
        <p className="text-lg md:text-xl leading-relaxed text-muted-foreground max-w-3xl">
          AI Smart Store is not a startup story about funding rounds and venture capital. It is a
          story about what a South African man built from nothing, with nothing, because giving up
          was not an option he was willing to take.
        </p>
      </div>
    </section>

    {/* The three blows */}
    <section className="border-b border-border bg-muted/30">
      <div className="container mx-auto px-4 py-16 md:py-20 max-w-5xl">
        <h2 className="font-display font-bold text-2xl md:text-3xl mb-3">Three blows, one year</h2>
        <p className="text-muted-foreground mb-12 max-w-2xl">
          Any one of these ends most businesses before they start. They arrived together.
        </p>

        <div className="grid gap-6 md:grid-cols-3">
          {BLOWS.map(({ n, icon: Icon, title, body }) => (
            <article key={n} className="rounded-2xl border border-border bg-card p-6 flex flex-col">
              <div className="flex items-center gap-3 mb-4">
                <span className="font-display font-extrabold text-2xl text-muted-foreground/40">{n}</span>
                <Icon className="h-5 w-5 text-primary" aria-hidden="true" />
              </div>
              <h3 className="font-display font-bold text-lg mb-2">{title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>

    {/* What he did next */}
    <section className="border-b border-border">
      <div className="container mx-auto px-4 py-16 md:py-24 max-w-4xl">
        <div className="flex items-center gap-3 mb-6">
          <Laptop className="h-5 w-5 text-primary" aria-hidden="true" />
          <p className="text-[11px] font-display font-bold uppercase tracking-[0.2em] text-muted-foreground">
            What happened next
          </p>
        </div>

        <h2 className="font-display font-extrabold text-2xl md:text-4xl leading-tight mb-8">
          He opened the laptop.
        </h2>

        <div className="space-y-6 text-base md:text-lg leading-relaxed text-muted-foreground max-w-3xl">
          <p>
            He found freeCodeCamp — a free, open-access coding curriculum available to anyone with an
            internet connection. He started at zero.
          </p>

          <div className="flex flex-wrap gap-2 py-2">
            {BUILT.map((skill) => (
              <span
                key={skill}
                className="rounded-full border border-border bg-card px-3 py-1 text-xs font-semibold text-foreground"
              >
                {skill}
              </span>
            ))}
          </div>

          <p>
            He completed module after module — with a fractured hand, in grief, without a home —
            until he had built something that did not exist before: a fully functional South African
            technology e-commerce platform, coded from scratch by a self-taught developer who had
            every reason to quit and chose not to.
          </p>

          <p className="text-foreground font-medium">
            Every product page, the cart, server-side price verification, payment processing and the
            order management flow were designed and built by hand. No Shopify template. No WordPress
            theme. Real engineering.
          </p>
        </div>
      </div>
    </section>

    {/* Credentials */}
    <section className="border-b border-border bg-muted/30">
      <div className="container mx-auto px-4 py-16 max-w-5xl">
        <h2 className="font-display font-bold text-2xl md:text-3xl mb-10">The business today</h2>
        <dl className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: Award, label: "B-BBEE", value: "Level 1 EME", note: "100% black-owned" },
            { icon: ShieldCheck, label: "Procurement", value: "135% recognition", note: "Maximum preferential score" },
            { icon: Laptop, label: "Platform", value: "Coded from scratch", note: "By the founder himself" },
            { icon: Wrench, label: "Supply", value: "Authorised distributors", note: "Genuine stock, SA-wide" },
          ].map(({ icon: Icon, label, value, note }) => (
            <div key={label} className="rounded-2xl border border-border bg-card p-6">
              <Icon className="h-5 w-5 text-primary mb-4" aria-hidden="true" />
              <dt className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{label}</dt>
              <dd className="font-display font-extrabold text-lg mt-1.5 leading-tight">{value}</dd>
              <dd className="text-xs text-muted-foreground mt-1">{note}</dd>
            </div>
          ))}
        </dl>

        <p className="text-xs text-muted-foreground mt-8">
          Registration 2025/599261/07 · CSD MAAA1656325 · Proudly South African
        </p>
      </div>
    </section>

    {/* Close */}
    <section>
      <div className="container mx-auto px-4 py-16 md:py-20 max-w-3xl text-center">
        <p className="font-display font-bold text-xl md:text-2xl leading-snug mb-8">
          Every line of code on this site was written by the person who owns it.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/products"
            className="inline-flex items-center gap-2 rounded-full bg-foreground text-background px-6 py-3 text-sm font-semibold hover:bg-foreground/90 transition-colors"
          >
            Shop the catalogue <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            to="/vision"
            className="inline-flex items-center gap-2 rounded-full border border-border px-6 py-3 text-sm font-semibold hover:border-foreground/30 transition-colors"
          >
            Our vision
          </Link>
        </div>
      </div>
    </section>
  </div>
);

export default About;
