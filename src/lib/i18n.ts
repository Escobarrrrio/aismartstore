import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import en from "./locales/en.json";
import af from "./locales/af.json";
import xh from "./locales/xh.json";
import zu from "./locales/zu.json";
import st from "./locales/st.json";

export const SUPPORTED_LANGUAGES = [
  { code: "en", label: "English", native: "English" },
  { code: "af", label: "Afrikaans", native: "Afrikaans" },
  { code: "xh", label: "isiXhosa", native: "isiXhosa" },
  { code: "zu", label: "isiZulu", native: "isiZulu" },
  { code: "st", label: "Sesotho", native: "Sesotho" },
] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]["code"];

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      af: { translation: af },
      xh: { translation: xh },
      zu: { translation: zu },
      st: { translation: st },
    },
    fallbackLng: "en",
    supportedLngs: SUPPORTED_LANGUAGES.map((l) => l.code),
    interpolation: { escapeValue: false },
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      lookupLocalStorage: "ai-smart-store.lang",
    },
  });

export default i18n;
