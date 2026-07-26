import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CurrencyCode, formatMoney } from "@/lib/currency";
import { ensureLanguageLoaded } from "@/lib/i18n";
import { useExchangeRates } from "@/hooks/useExchangeRates";

interface LocaleContextType {
  currency: CurrencyCode;
  setCurrency: (c: CurrencyCode) => void;
  language: string;
  setLanguage: (l: string) => void;
  /** Converts a ZAR-stored amount to the active currency AND formats it -- use this everywhere a price is shown. */
  formatPrice: (zarAmount: number | string | null | undefined) => string;
}

const LocaleContext = createContext<LocaleContextType | undefined>(undefined);

const CURRENCY_KEY = "ai-smart-store.currency";

export const LocaleProvider = ({ children }: { children: ReactNode }) => {
  const { i18n } = useTranslation();
  const { convert } = useExchangeRates();
  const [currency, setCurrencyState] = useState<CurrencyCode>(() => {
    try {
      if (typeof window !== "undefined" && typeof window.localStorage?.getItem === "function") {
        const stored = window.localStorage.getItem(CURRENCY_KEY) as CurrencyCode | null;
        return stored || "ZAR";
      }
    } catch {
      // Ignore storage errors
    }
    return "ZAR";
  });

  const setCurrency = (c: CurrencyCode) => {
    setCurrencyState(c);
    try {
      if (typeof window !== "undefined" && typeof window.localStorage?.setItem === "function") {
        window.localStorage.setItem(CURRENCY_KEY, c);
      }
    } catch {
      // Ignore storage errors
    }
  };

  const formatPrice = (zarAmount: number | string | null | undefined) => {
    const num = typeof zarAmount === "string" ? parseFloat(zarAmount) : (zarAmount ?? 0);
    if (Number.isNaN(num)) return "—";
    return formatMoney(convert(num, currency), currency);
  };

  const setLanguage = (l: string) => {
    ensureLanguageLoaded(l).then(() => i18n.changeLanguage(l));
  };

  useEffect(() => {
    document.documentElement.lang = i18n.language || "en";
  }, [i18n.language]);

  return (
    <LocaleContext.Provider value={{ currency, setCurrency, language: i18n.language, setLanguage, formatPrice }}>
      {children}
    </LocaleContext.Provider>
  );
};

export const useLocale = () => {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used within LocaleProvider");
  return ctx;
};
