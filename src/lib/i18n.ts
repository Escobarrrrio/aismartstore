import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

// Core South African languages ship in the main bundle -- this is the
// primary market and these are small enough that bundling them costs
// nothing meaningful.
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
  { code: "fr", label: "French", native: "Français" },
  { code: "es", label: "Spanish", native: "Español" },
  { code: "pt", label: "Portuguese", native: "Português" },
  { code: "de", label: "German", native: "Deutsch" },
  { code: "zh", label: "Mandarin Chinese", native: "中文" },
  { code: "ar", label: "Arabic", native: "العربية" },
  { code: "hi", label: "Hindi", native: "हिन्दी" },
  { code: "ru", label: "Russian", native: "Русский" },
] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]["code"];

const BUNDLED_LANGUAGES: LanguageCode[] = ["en", "af", "xh", "zu", "st"];

// The 8 international languages are loaded on demand via dynamic
// import() rather than bundled upfront -- a customer browsing in
// English (the overwhelming majority, given this is a South African
// store) shouldn't have to download Arabic, Mandarin, and Hindi JSON
// they'll never read. Each is ~9-16KB; lazy-loading keeps the main
// bundle lean while still making all 13 languages fully available.
const LAZY_LOADERS: Partial<Record<LanguageCode, () => Promise<{ default: object }>>> = {
  fr: () => import("./locales/fr.json"),
  es: () => import("./locales/es.json"),
  pt: () => import("./locales/pt.json"),
  de: () => import("./locales/de.json"),
  zh: () => import("./locales/zh.json"),
  ar: () => import("./locales/ar.json"),
  hi: () => import("./locales/hi.json"),
  ru: () => import("./locales/ru.json"),
};

const loadedLazy = new Set<LanguageCode>();

/** Loads and registers a lazy language bundle if not already loaded. No-op for bundled languages. */
export async function ensureLanguageLoaded(code: string) {
  const lang = code as LanguageCode;
  if (BUNDLED_LANGUAGES.includes(lang) || loadedLazy.has(lang)) return;
  const loader = LAZY_LOADERS[lang];
  if (!loader) return;
  const mod = await loader();
  i18n.addResourceBundle(lang, "translation", mod.default, true, true);
  loadedLazy.add(lang);
}

export const RTL_LANGUAGES: LanguageCode[] = ["ar"];

export function applyDocumentDirection(lang: string) {
  if (typeof document === "undefined") return;
  document.documentElement.dir = RTL_LANGUAGES.includes(lang as LanguageCode) ? "rtl" : "ltr";
  document.documentElement.lang = lang;
}

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
  })
  .then(() => {
    // If the detected/persisted language is one of the lazy ones,
    // load it now -- the UI shows the English fallback for the brief
    // moment until this resolves, then re-renders in the right language.
    void ensureLanguageLoaded(i18n.language).then(() => {
      if (!BUNDLED_LANGUAGES.includes(i18n.language as LanguageCode)) {
        i18n.emit("languageChanged", i18n.language);
      }
    });
  });

applyDocumentDirection(i18n.language);
i18n.on("languageChanged", applyDocumentDirection);

export default i18n;
