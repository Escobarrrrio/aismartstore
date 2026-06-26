import { Link } from "react-router-dom";

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
 * Renders an inline SVG so it stays crisp at every size and respects the
 * brand gradient (cyan → violet → magenta) without depending on a bitmap.
 */
const Logo = ({
  size = 36,
  showWordmark = true,
  asLink = true,
  invert = false,
  className = "",
}: LogoProps) => {
  const wordmarkSize = Math.round(size * 0.5); // px font-size relative to icon
  const gap = Math.max(6, Math.round(size * 0.22));

  const inner = (
    <span
      className={`inline-flex items-center ${className}`}
      style={{ gap: `${gap}px` }}
      aria-label="AI Smart Store"
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="flex-shrink-0"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="aismartstore-logo-grad" x1="4" y1="4" x2="44" y2="44" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#06b6d4" />
            <stop offset="55%" stopColor="#7c3aed" />
            <stop offset="100%" stopColor="#ec4899" />
          </linearGradient>
        </defs>
        {/* Rounded square background tile */}
        <rect x="2" y="2" width="44" height="44" rx="12" fill="url(#aismartstore-logo-grad)" />
        {/* Angular "N"-shape mark in white */}
        <path
          d="M14 35V13h4.6l10.8 14.2V13H34v22h-4.6L18.6 20.8V35H14Z"
          fill="#ffffff"
        />
      </svg>

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
