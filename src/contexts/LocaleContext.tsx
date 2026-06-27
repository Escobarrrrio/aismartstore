import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CurrencyCode } from "@/lib/currency";
import { ensureLanguageLoaded } from "@/lib/i18n";

interface LocaleContextType {
  currency: CurrencyCode;
  setCurrency: (c: CurrencyCode) => void;
  language: string;
  setLanguage: (l: string) => void;
}

const LocaleContext = createContext<LocaleContextType | undefined>(undefined);

const CURRENCY_KEY = "ai-smart-store.currency";

export const LocaleProvider = ({ children }: { children: ReactNode }) => {
  const { i18n } = useTranslation();
  const [currency, setCurrencyState] = useState<CurrencyCode>(() => {
    const stored = (typeof window !== "undefined" && localStorage.getItem(CURRENCY_KEY)) as CurrencyCode | null;
    return stored || "ZAR";
  });

  const setCurrency = (c: CurrencyCode) => {
    setCurrencyState(c);
    localStorage.setItem(CURRENCY_KEY, c);
  };

  const setLanguage = (l: string) => {
    ensureLanguageLoaded(l).then(() => i18n.changeLanguage(l));
  };

  useEffect(() => {
    document.documentElement.lang = i18n.language || "en";
  }, [i18n.language]);

  return (
    <LocaleContext.Provider value={{ currency, setCurrency, language: i18n.language, setLanguage }}>
      {children}
    </LocaleContext.Provider>
  );
};

export const useLocale = () => {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used within LocaleProvider");
  return ctx;
};
