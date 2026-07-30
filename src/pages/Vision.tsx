import SEO from "@/components/SEO";
import { Link } from "react-router-dom";
import { ArrowRight, Globe, Compass, Layers } from "lucide-react";

/**
 * The vision statement, given a page of its own.
 *
 * The statement itself is verbatim from the company profile. Everything around
 * it exists to make it mean something: a vision that cannot be checked is a
 * slogan, so each pillar below names what would have to be true for the vision
 * to be real, in terms this business can actually be held to.
 */

const PILLARS = [
  {
    icon: Globe,
    title: "Regardless of where they live",
    body:
      "The phrase in the vision that does the most work. Gqeberha, Mthatha, Upington and Sandton get the same catalogue, the same prices and the same delivery promise. Where a courier can reach, we sell.",
  },
  {
    icon: Compass,
    title: "Most trusted",
    body:
      "Trust is not a claim, it is an accumulation of small honesties: real stock states, delivery dates calculated rather than invented, prices verified server-side, and no product listed that we cannot actually supply.",
  },
  {
    icon: Layers,
    title: "The latest global tech",
    body:
      "Sourced through authorised South African distributors, so what arrives is genuine, warrantied and supported locally. Grey imports are cheaper and we do not sell them.",
  },
];

const Vision = () => (
  <div className="flex flex-col">
    <SEO
      title="Our Vision"
      description="To be South Africa's most trusted and accessible technology and AI retail platform — bringing the latest global tech to every South African, regardless of where they live."
      path="/vision"
    />

    <section className="border-b border-border">
      <div className="container mx-auto px-4 py-16 md:py-24 max-w-4xl">
        <p className="text-[11px] font-display font-bold uppercase tracking-[0.2em] text-muted-foreground mb-6">
          Our Vision
        </p>
        <blockquote className="font-display font-extrabold text-2xl md:text-4xl leading-[1.25]">
          To be South Africa's most trusted and accessible technology and AI retail platform —
          bringing the latest global tech to{" "}
          <span className="shimmer-text">every South African</span>, regardless of where they live.
        </blockquote>
      </div>
    </section>

    <section className="border-b border-border bg-muted/30">
      <div className="container mx-auto px-4 py-16 md:py-20 max-w-5xl">
        <h2 className="font-display font-bold text-2xl mb-3">What it commits us to</h2>
        <p className="text-muted-foreground mb-12 max-w-2xl">
          A vision nobody can check is a slogan. These are the parts we can be held to.
        </p>

        <div className="grid gap-6 md:grid-cols-3">
          {PILLARS.map(({ icon: Icon, title, body }) => (
            <article key={title} className="rounded-2xl border border-border bg-card p-6">
              <Icon className="h-5 w-5 text-primary mb-4" aria-hidden="true" />
              <h3 className="font-display font-bold text-base mb-2 leading-snug">{title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>

    <section>
      <div className="container mx-auto px-4 py-16 max-w-3xl text-center">
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/mission"
            className="inline-flex items-center gap-2 rounded-full bg-foreground text-background px-6 py-3 text-sm font-semibold hover:bg-foreground/90 transition-colors"
          >
            How we get there <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            to="/about"
            className="inline-flex items-center gap-2 rounded-full border border-border px-6 py-3 text-sm font-semibold hover:border-foreground/30 transition-colors"
          >
            The story behind it
          </Link>
        </div>
      </div>
    </section>
  </div>
);

export default Vision;
