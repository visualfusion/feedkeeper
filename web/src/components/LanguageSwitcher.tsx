import { useTranslation } from "react-i18next";
import { supportedLanguages } from "../i18n/index.ts";
import { rememberLanguage } from "../i18n/remember.ts";
import { CustomSelect } from "./CustomSelect.tsx";

const ALL_LANGUAGE_OPTIONS = [
  { value: "de", label: "Deutsch" },
  { value: "en", label: "English" },
  { value: "ja", label: "日本語" },
  { value: "ru", label: "Русский" },
];

const LANGUAGES = ALL_LANGUAGE_OPTIONS.filter((opt) => supportedLanguages.includes(opt.value));

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();

  return (
    <CustomSelect
      value={i18n.resolvedLanguage ?? "de"}
      onChange={(lang) => { rememberLanguage(lang); void i18n.changeLanguage(lang); }}
      options={LANGUAGES}
      className="w-44"
      ariaLabel={t("settings.language")}
    />
  );
}
