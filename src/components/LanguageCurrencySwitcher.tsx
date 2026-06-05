import { useState, useRef, useEffect } from "react";
import { Globe, Check, ChevronDown } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";
import { SUPPORTED_LANGUAGES } from "@/lib/i18n";
import { SUPPORTED_CURRENCIES } from "@/lib/currency";

const LanguageCurrencySwitcher = () => {
  const { language, setLanguage, currency, setCurrency } = useLocale();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const currentLang = SUPPORTED_LANGUAGES.find((l) => l.code === language) ?? SUPPORTED_LANGUAGES[0];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 h-10 px-3 rounded-xl border border-border hover:bg-muted transition-colors text-xs font-semibold"
        aria-label="Change language or currency"
      >
        <Globe className="h-4 w-4 text-muted-foreground" />
        <span className="hidden sm:inline">{currentLang.code.toUpperCase()}</span>
        <span className="text-muted-foreground hidden md:inline">·</span>
        <span className="text-muted-foreground hidden md:inline">{currency}</span>
        <ChevronDown className="h-3 w-3 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-64 max-w-[calc(100vw-2rem)] bg-card border border-border rounded-xl shadow-lg z-50 overflow-hidden">
          <div className="p-3 border-b border-border">
            <p className="text-[10px] font-display font-bold uppercase tracking-wider text-muted-foreground mb-2">Language</p>
            <div className="space-y-0.5">
              {SUPPORTED_LANGUAGES.map((l) => (
                <button
                  key={l.code}
                  onClick={() => { setLanguage(l.code); setOpen(false); }}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-sm transition-colors ${
                    language === l.code ? "bg-primary/[0.06] text-primary font-semibold" : "hover:bg-muted text-foreground"
                  }`}
                >
                  <span>{l.native}</span>
                  {language === l.code && <Check className="h-3.5 w-3.5" />}
                </button>
              ))}
            </div>
          </div>
          <div className="p-3 max-h-64 overflow-y-auto">
            <p className="text-[10px] font-display font-bold uppercase tracking-wider text-muted-foreground mb-2">Currency</p>
            <div className="space-y-0.5">
              {SUPPORTED_CURRENCIES.map((c) => (
                <button
                  key={c.code}
                  onClick={() => { setCurrency(c.code); setOpen(false); }}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-sm transition-colors ${
                    currency === c.code ? "bg-primary/[0.06] text-primary font-semibold" : "hover:bg-muted text-foreground"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="w-7 text-xs text-muted-foreground font-mono">{c.symbol}</span>
                    <span>{c.code}</span>
                    <span className="text-xs text-muted-foreground hidden sm:inline">— {c.label}</span>
                  </span>
                  {currency === c.code && <Check className="h-3.5 w-3.5" />}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LanguageCurrencySwitcher;
