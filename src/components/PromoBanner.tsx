import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";

interface PromoBannerProps {
  /** WebP image path under /public, already sized+compressed for the web. */
  src: string;
  /** Describes the banner artwork itself, not the promotion — for screen readers. */
  alt: string;
  to: string;
  eyebrow: string;
  cta: string;
}

/**
 * A single promotional banner card: full-bleed image, gradient scrim for
 * legible text at any crop, one honest call-to-action linking into the real
 * catalogue. No price or discount text is layered on top here — the banner
 * artwork is decorative, the destination is the actual, current stock and
 * pricing, so nothing shown can go stale or contradict checkout.
 */
const PromoBanner = ({ src, alt, to, eyebrow, cta }: PromoBannerProps) => (
  <Link
    to={to}
    className="group relative block overflow-hidden rounded-2xl aspect-[16/9] sm:aspect-[21/7] shadow-elevated"
  >
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      width={1600}
      height={535}
      className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
    />
    <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/10 to-transparent" />
    <div className="absolute inset-x-0 bottom-0 p-5 sm:p-6 flex items-end justify-between gap-4">
      <p className="text-white/85 text-xs font-semibold uppercase tracking-widest">{eyebrow}</p>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-white/95 px-4 py-2 text-xs font-semibold text-foreground group-hover:bg-white transition-colors flex-shrink-0">
        {cta} <ArrowRight className="h-3.5 w-3.5" />
      </span>
    </div>
  </Link>
);

export default PromoBanner;
