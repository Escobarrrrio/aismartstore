import SEO from "@/components/SEO";
import { Link } from "react-router-dom";
import { ArrowRight, PackageCheck, Banknote, HandHeart, MapPin } from "lucide-react";

/**
 * The mission statement.
 *
 * Where the vision says where we are going, this says how. The four commitments
 * below map one-to-one onto the four clauses of the statement, so nothing here
 * is decoration -- each one is a promise with a mechanism behind it, and each
 * mechanism already exists in the platform rather than being aspirational.
 */

const COMMITMENTS = [
  {
    icon: PackageCheck,
    clause: "the world's best technology brands",
    title: "Real brands, not lookalikes",
    body:
      "HP, Dell, Logitech, Kingston, Aruba and the rest — the names people already trust, rather than unbranded stock chosen purely on margin.",
  },
  {
    icon: MapPin,
    clause: "through authorised South African distributors",
    title: "Authorised channel only",
    body:
      "Stock comes through the official local channel, so it carries a valid South African warranty and can be supported here. Grey imports undercut us on price; we do not carry them.",
  },
  {
    icon: Banknote,
    clause: "at competitive prices",
    title: "Priced to be bought",
    body:
      "Lean and high-volume by design. Prices are verified server-side at checkout so what a customer is charged always matches what the page showed.",
  },
  {
    icon: HandHeart,
    clause: "backed by human service and proudly local values",
    title: "A person behind it",
    body:
      "One founder, reachable and accountable. Delivery dates are calculated from real dispatch times and public holidays rather than guessed, because a broken promise costs more than a lost sale.",
  },
];

const Mission = () => (
  <div className="flex flex-col">
    <SEO
      title="Our Mission"
      description="To source the world's best technology brands through authorised South African distributors and deliver them at competitive prices, backed by human service and proudly local values."
      path="/mission"
    />

    <section className="border-b border-border">
      <div className="container mx-auto px-4 py-16 md:py-24 max-w-4xl">
        <p className="text-[11px] font-display font-bold uppercase tracking-[0.2em] text-muted-foreground mb-6">
          Our Mission
        </p>
        <blockquote className="font-display font-extrabold text-2xl md:text-4xl leading-[1.25]">
          To source the world's best technology brands through authorised South African
          distributors and deliver them at competitive prices, backed by{" "}
          <span className="shimmer-text">human service</span> and proudly local values.
        </blockquote>
      </div>
    </section>

    <section className="border-b border-border bg-muted/30">
      <div className="container mx-auto px-4 py-16 md:py-20 max-w-5xl">
        <h2 className="font-display font-bold text-2xl mb-3">Four clauses, four mechanisms</h2>
        <p className="text-muted-foreground mb-12 max-w-2xl">
          Each promise below already has something behind it in the platform. None of it is a
          plan for later.
        </p>

        <div className="grid gap-6 sm:grid-cols-2">
          {COMMITMENTS.map(({ icon: Icon, clause, title, body }) => (
            <article key={title} className="rounded-2xl border border-border bg-card p-6">
              <Icon className="h-5 w-5 text-primary mb-4" aria-hidden="true" />
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2 italic">
                “{clause}”
              </p>
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
            to="/products"
            className="inline-flex items-center gap-2 rounded-full bg-foreground text-background px-6 py-3 text-sm font-semibold hover:bg-foreground/90 transition-colors"
          >
            See what we stock <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            to="/procurement"
            className="inline-flex items-center gap-2 rounded-full border border-border px-6 py-3 text-sm font-semibold hover:border-foreground/30 transition-colors"
          >
            Business & government
          </Link>
        </div>
      </div>
    </section>
  </div>
);

export default Mission;
