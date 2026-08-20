import { Home, Building2, ArrowRight, Lock } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAudience, type ShoppingMode } from "@/contexts/AudienceContext";
import { useSession } from "@/hooks/useSession";
import { trackEvent } from "@/lib/analytics";
import Logo from "@/components/Logo";


/**
 * First-visit routing layer.
 *
 * Full-screen and blocking on purpose: the choice decides which slice of the
 * catalogue every subsequent query is allowed to return, so it has to happen
 * before the storefront renders rather than as an afterthought filter.
 * Rendered only from the home page; once answered it is stored and never
 * shown again (see AudienceContext).
 */
const AudienceEntryGate = () => {
  const { mode, ready, setMode } = useAudience();
  const { t } = useTranslation();
  const session = useSession();
  const navigate = useNavigate();


  if (!ready || mode) return null;

  // The business portal exposes trade pricing, compliance packs and quoting,
  // so it is registered-buyers-only. Choosing it while signed out records the
  // choice and hands off to sign-in, which returns here on success.
  const choose = (next: ShoppingMode) => {
    setMode(next);
    trackEvent({ name: "audience_selected", value: next, page: "/" });
    if (next === "business") {
      navigate(session ? "/procurement" : "/auth?redirect=%2Fprocurement");
    }
  };

  const options: {
    value: ShoppingMode;
    Icon: typeof Home;
    title: string;
    blurb: string;
    examples: string;
    note?: string;
  }[] = [
    {
      value: "residential",
      Icon: Home,
      title: "My Home or Studies",
      blurb: "Everyday tech for households, students and creators.",
      examples: "Laptops · Monitors · Peripherals · Smart home · Storage",
    },
    {
      value: "business",
      Icon: Building2,
      title: "A Business or Enterprise",
      blurb: "Infrastructure, licensing and government procurement.",
      examples: "Servers · Networking · Licensing · Care packs · Quotes",
      note: "Sign-in required — reserved for registered business & government buyers",
    },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="audience-gate-title"
      data-testid="audience-entry-gate"
      className="fixed inset-0 z-[100] bg-background/98 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
    >
      <div className="w-full max-w-3xl py-10">
        <div className="flex justify-center mb-8">
          <Logo />
        </div>

        <h1
          id="audience-gate-title"
          className="font-display font-extrabold text-2xl sm:text-3xl text-center text-foreground"
        >
          Who are you shopping for?
        </h1>
        <p className="text-muted-foreground text-center mt-3 max-w-lg mx-auto text-sm sm:text-base">
          We keep home tech and enterprise infrastructure strictly separate, so you
          only ever see gear that is actually meant for you.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-8">
          {options.map(({ value, Icon, title, blurb, examples, note }) => (
            <button
              key={value}
              type="button"
              data-testid={`gate-choose-${value}`}
              onClick={() => choose(value)}
              className="group text-left card-premium p-6 hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-all"
            >
              <span className="inline-flex items-center justify-center h-12 w-12 rounded-2xl bg-primary/[0.08] text-primary mb-4">
                <Icon className="h-6 w-6" aria-hidden="true" />
              </span>
              <span className="block font-display font-bold text-lg text-foreground">{title}</span>
              <span className="block text-sm text-muted-foreground mt-2">{blurb}</span>
              <span className="block text-xs text-muted-foreground/80 mt-3">{examples}</span>
              {note && (
                <span className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                  <Lock className="h-3 w-3" aria-hidden="true" />
                  {note}
                </span>
              )}
              <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
                Continue
                <ArrowRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" aria-hidden="true" />
              </span>
            </button>
          ))}
        </div>

        <p className="text-xs text-muted-foreground text-center mt-6">
          You can switch at any time from the catalogue scope selector.
        </p>
      </div>
    </div>
  );
};

export default AudienceEntryGate;
