import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import en from "./locales/en.json";
import de from "./locales/de.json";
import ru from "./locales/ru.json";
import ja from "./locales/ja.json";
import { LANGUAGE_KEY } from "./remember.ts";

const ALL_LANGUAGES = ["en", "de", "ja", "ru"] as const;

function resolveSupportedLanguages(): string[] {
  if (typeof document !== "undefined") {
    const raw = document.querySelector('meta[name="feedkeeper-languages"]')?.getAttribute("content");
    if (raw) {
      const filtered = raw
        .split(",")
        .map((code) => code.trim().toLowerCase())
        .filter((code) => (ALL_LANGUAGES as readonly string[]).includes(code));
      if (filtered.length > 0) return filtered;
    }
  }
  return [...ALL_LANGUAGES];
}

export const supportedLanguages = resolveSupportedLanguages();

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      de: { translation: de },
      ru: { translation: ru },
      ja: { translation: ja },
    },
    fallbackLng: "en",
    supportedLngs: supportedLanguages,
    interpolation: { escapeValue: false },
    // An explicit choice (stored by rememberLanguage) comes first, then the system's language. What the detector finds
    // is not stored, so that only a real choice overrides the system.
    detection: {
      order: ["cookie", "localStorage", "navigator"],
      caches: [],
      lookupCookie: LANGUAGE_KEY,
      lookupLocalStorage: LANGUAGE_KEY,
    },
  });

export default i18n;
