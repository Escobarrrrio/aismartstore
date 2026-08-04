import { useState } from "react";
import SEO from "@/components/SEO";
import { Link } from "react-router-dom";
import { ArrowRight, Flame, HeartCrack, Wrench, Laptop, ShieldCheck, Award, MapPin } from "lucide-react";
import { useSiteImages } from "@/hooks/useSiteImages";

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
 *
 * ON THE PHOTOGRAPHS
 * ------------------
 * Two slots on this page take real photographs, set from Admin -> Photos:
 * the opening frame and the Gelvandale frame. They are deliberately not
 * shipped in the bundle and deliberately not stock photography. A stock photo
 * of "a South African township" under a story about a specific street in a
 * specific suburb would be a small lie told in a place that cannot afford one,
 * and this page's entire argument is that the details are real.
 *
 * Until they are set, each slot renders a composed typographic plate rather
 * than an empty box or a placeholder graphic. The page has to look finished
 * either way -- it is a shopfront, not a draft.
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

/**
 * The frame used for both photographic slots.
 *
 * `label` and `caption` are not alternative text for a missing image -- they
 * are the composition that runs when there is no image, and they have to hold
 * the layout on their own. Hence the fixed aspect ratio: the page does not
 * reflow when a photo is added later, so what the owner previews is what a
 * shopper gets.
 */
const StoryFrame = ({
  src,
  alt,
  label,
  caption,
  priority = false,
}: {
  src: string | null | undefined;
  alt: string;
  label: string;
  caption: string;
  priority?: boolean;
}) => {
  const [failed, setFailed] = useState(false);
  const showPhoto = Boolean(src) && !failed;

  return (
    <figure className="relative overflow-hidden rounded-3xl bg-foreground aspect-[4/3] md:aspect-[3/2]">
      {showPhoto ? (
        <img
          src={src!}
          alt={alt}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <>
          {/* Layered radials rather than a flat fill, so the plate reads as a
              designed surface at any size instead of a grey rectangle that
              happens to have text on it. */}
          <div
            aria-hidden="true"
            className="absolute inset-0"
            style={{
              backgroundImage:
                "radial-gradient(120% 100% at 12% 0%, hsl(var(--primary) / 0.35), transparent 58%), " +
                "radial-gradient(90% 80% at 100% 100%, hsl(var(--primary) / 0.18), transparent 62%)",
            }}
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 opacity-[0.18]"
            style={{
              backgroundImage:
                "radial-gradient(hsl(var(--background) / 0.9) 1px, transparent 1px)",
              backgroundSize: "22px 22px",
            }}
          />
        </>
      )}

      {/* Runs over both states: a caption legible on a photograph needs the
          scrim, and the plate needs the same weighting at the bottom. */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-foreground via-foreground/70 to-transparent p-6 md:p-8">
        <p className="text-[11px] font-display font-bold uppercase tracking-[0.22em] text-background/70">
          {label}
        </p>
        <p className="mt-1.5 font-display font-bold text-background text-lg md:text-xl leading-snug max-w-md">
          {caption}
        </p>
      </div>
    </figure>
  );
};

const About = () => {
  const images = useSiteImages(["about_hero_image", "about_place_image"]);

  return (
    <div className="flex flex-col">
      <SEO
        title="Our Story"
        description="AI Smart Store was coded from scratch by founder Fernando Steyn — self-taught, in Gelvandale, Gqeberha, after a welding accident, a bereavement and a house fire. A 100% black-owned, B-BBEE Level 1 South African technology retailer."
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
              address: {
                "@type": "PostalAddress",
                addressLocality: "Gqeberha",
                addressRegion: "Eastern Cape",
                addressCountry: "ZA",
              },
              description:
                "South African consumer and B2B technology e-commerce platform, custom-built by its founder in Gelvandale, Gqeberha.",
            },
          },
        ]}
      />

      {/* Opening */}
      <section className="border-b border-border">
        <div className="container mx-auto px-4 py-16 md:py-24">
          <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
            <div className="max-w-xl">
              <p className="inline-flex items-center gap-2 text-[11px] font-display font-bold uppercase tracking-[0.2em] text-muted-foreground mb-6">
                <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                Gelvandale · Gqeberha · Eastern Cape
              </p>
              <h1 className="font-display font-extrabold text-4xl md:text-6xl leading-[1.03] tracking-tight mb-7">
                Built from nothing,
                <br />
                with nothing.
              </h1>
              <p className="text-lg md:text-xl leading-relaxed text-muted-foreground">
                AI Smart Store is not a startup story about funding rounds and venture capital. It is
                a story about what a South African man built from nothing, with nothing, because
                giving up was not an option he was willing to take.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-3 text-sm">
                <span className="font-display font-bold">Est. 19 July 2026</span>
                <span className="text-muted-foreground">B-BBEE Level 1 · 100% black-owned</span>
              </div>
            </div>

            <StoryFrame
              priority
              src={images?.about_hero_image}
              alt="Fernando Steyn, founder of AI Smart Store"
              label="The founder"
              caption="Fernando Steyn — welder, then self-taught developer."
            />
          </div>
        </div>
      </section>

      {/* Gelvandale */}
      <section className="border-b border-border bg-muted/30">
        <div className="container mx-auto px-4 py-16 md:py-24">
          <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
            <StoryFrame
              src={images?.about_place_image}
              alt="Gelvandale, Gqeberha, Eastern Cape"
              label="Home"
              caption="Gelvandale, in the Northern Areas of Gqeberha."
            />

            <div className="max-w-xl lg:order-first">
              <p className="text-[11px] font-display font-bold uppercase tracking-[0.2em] text-muted-foreground mb-5">
                Where this started
              </p>
              <h2 className="font-display font-extrabold text-2xl md:text-4xl leading-tight mb-7">
                Gelvandale is not a footnote.
                <br />
                It is the address.
              </h2>
              <div className="space-y-5 text-base md:text-lg leading-relaxed text-muted-foreground">
                <p>
                  This company is run from Gelvandale, in the Northern Areas of Gqeberha — a
                  working-class community in the Eastern Cape that produces a great deal more talent
                  than it is usually credited with.
                </p>
                <p>
                  National technology platforms are supposed to come from somewhere else. From
                  Sandton, from Century City, from an accelerator with a coffee bar. This one does
                  not, and that is not a disclaimer — it is the most interesting fact about it.
                </p>
                <p className="text-foreground font-medium">
                  Every order placed here is fulfilled by a business run from this neighbourhood, by
                  someone who lives in it. Buying from AI Smart Store puts money into the Eastern
                  Cape, not through it.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* The three blows */}
      <section className="border-b border-border">
        <div className="container mx-auto px-4 py-16 md:py-20 max-w-5xl">
          <h2 className="font-display font-extrabold text-2xl md:text-3xl mb-3">Three blows, one year</h2>
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
      <section className="border-b border-border bg-muted/30">
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
      <section className="border-b border-border">
        <div className="container mx-auto px-4 py-16 max-w-5xl">
          <h2 className="font-display font-extrabold text-2xl md:text-3xl mb-10">The business today</h2>
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
            Registration 2025/599261/07 · CSD MAAA1656325 · Gqeberha, Eastern Cape · Proudly South African
          </p>
        </div>
      </section>

      {/* Close */}
      <section>
        <div className="container mx-auto px-4 py-16 md:py-24 max-w-3xl text-center">
          <p className="font-display font-extrabold text-2xl md:text-3xl leading-snug mb-8">
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
};

export default About;
