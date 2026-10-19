import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import en from "./locales/en.json";
import de from "./locales/de.json";
import ja from "./locales/ja.json";
import { LANGUAGE_KEY } from "./remember.ts";

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      de: { translation: de },
      ja: { translation: ja },
    },
    fallbackLng: "en",
    supportedLngs: ["en", "de", "ja"],
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
