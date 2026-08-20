import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Home, Building2, Check, ChevronDown } from "lucide-react";
import { useAudience, type ShoppingMode } from "@/contexts/AudienceContext";
import { useSession } from "@/hooks/useSession";
import { trackEvent } from "@/lib/analytics";

/**
 * Always-available portal switcher.
 *
 * The entry gate only ever shows once, so this is the permanent escape hatch:
 * it lets a shopper move between the Home/Studies and Business/Enterprise
 * catalogues at any point without clearing storage. Rendered in the header,
 * so it follows the shopper across every page.
 */
const OPTIONS: { value: ShoppingMode; labelKey: string; Icon: typeof Home }[] = [
  { value: "residential", labelKey: "audienceGate.home", Icon: Home },
  { value: "business", labelKey: "audienceGate.business", Icon: Building2 },
];

const AudienceSwitcher = ({ className = "" }: { className?: string }) => {
  const { mode, ready, setMode } = useAudience();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const session = useSession();
  const wrapRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();


  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!ready || !mode) return null;

  const current = OPTIONS.find((o) => o.value === mode) ?? OPTIONS[0];
  const CurrentIcon = current.Icon;

  const choose = (next: ShoppingMode) => {
    setOpen(false);
    if (next === mode) return;
    setMode(next);
    trackEvent({ name: "audience_selected", value: next, page: window.location.pathname });
    // Business portal is registered-buyers-only: send signed-out shoppers
    // through sign-in first, then straight into procurement.
    if (next === "business") {
      navigate(session ? "/procurement" : "/auth?redirect=%2Fprocurement");
      return;
    }
    navigate("/products");
  };

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <button
        type="button"
        data-testid="audience-switcher"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${t("audienceGate.switcherLabel")}: ${t(current.labelKey)}`}
        className="flex items-center gap-1.5 h-10 px-2.5 sm:px-3 rounded-xl border border-border text-sm font-medium hover:bg-muted transition-colors whitespace-nowrap"
      >
        <CurrentIcon className="h-4 w-4 text-primary" aria-hidden="true" />
        <span className="hidden lg:inline">{t(current.labelKey)}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-60 rounded-xl border border-border bg-background shadow-lg p-1.5 z-50 animate-fade-in"
        >
          <p className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("audienceGate.switcherLabel")}
          </p>
          {OPTIONS.map(({ value, labelKey, Icon }) => (
            <button
              key={value}
              type="button"
              role="menuitemradio"
              aria-checked={value === mode}
              data-testid={`audience-switch-${value}`}
              onClick={() => choose(value)}
              className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-left transition-colors ${
                value === mode ? "bg-primary/[0.06] text-primary font-semibold" : "hover:bg-muted text-foreground"
              }`}
            >
              <Icon className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
              <span className="flex-1">{t(labelKey)}</span>

              {value === mode && <Check className="h-4 w-4" aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default AudienceSwitcher;
