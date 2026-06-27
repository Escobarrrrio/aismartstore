import { Link } from "react-router-dom";
import logoIcon from "@/assets/logo.png";

interface LogoProps {
  /** Pixel size of the icon. The wordmark scales relative to this. */
  size?: number;
  /** Show "Smart Store" wordmark next to the icon. */
  showWordmark?: boolean;
  /** Wrap in a Link to "/". When false, renders a plain span. */
  asLink?: boolean;
  /** Use white wordmark (for dark backgrounds like footer / admin sidebar). */
  invert?: boolean;
  className?: string;
}

/**
 * Canonical AI Smart Store logo.
 *
 * Uses the actual brand icon asset (src/assets/logo.png -- the glossy
 * gradient "Ni" checkmark mark, uploaded 2026-06-05) rather than a
 * hand-drawn approximation. This is the single source of truth for the
 * logo: header, auth page, footer, and admin sidebar all render through
 * this component so they can never drift out of sync with each other
 * or with the real brand asset again.
 */
const Logo = ({
  size = 36,
  showWordmark = true,
  asLink = true,
  invert = false,
  className = "",
}: LogoProps) => {
  const wordmarkSize = Math.round(size * 0.5); // px font-size relative to icon
  const gap = Math.max(4, Math.round(size * 0.12));

  const inner = (
    <span
      className={`inline-flex items-center ${className}`}
      style={{ gap: `${gap}px` }}
      aria-label="AI Smart Store"
    >
      <img
        src={logoIcon}
        alt=""
        width={size}
        height={size}
        className="flex-shrink-0 object-contain"
        style={{ width: `${size}px`, height: `${size}px` }}
        aria-hidden="true"
      />

      {showWordmark && (
        <span
          className={`font-display font-extrabold tracking-tight whitespace-nowrap ${
            invert ? "text-background" : "gradient-brand-text"
          }`}
          style={{ fontSize: `${wordmarkSize}px`, lineHeight: 1 }}
        >
          Smart Store
        </span>
      )}
    </span>
  );

  if (!asLink) return inner;

  return (
    <Link to="/" className="inline-flex items-center" aria-label="AI Smart Store — Home">
      {inner}
    </Link>
  );
};

export default Logo;
