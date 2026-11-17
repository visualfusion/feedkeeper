import de from "./de.js";
import en from "./en.js";
import ja from "./ja.js";

const LANGUAGES = [de, en, ja];
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** One file per language, searched all at once. To add a language, add a file next to these and list it here. */
export const RELATIVE_AGES: readonly RegExp[] = LANGUAGES.flatMap(language => language.relativeAges);
export const SECTION_KICKERS: readonly RegExp[] = LANGUAGES.flatMap(language => language.kickers);

const WEEKDAY = `(?:${LANGUAGES.flatMap(language => language.weekdays).map(escape).join("|")})`;
/** `2026-11-17`, `2026.11.17 Tue`, `17.11.2026 Di`, `2026年11月17日 17時54分`, repeated as some pages print it twice: a date a reader's head already shows. */
const NUMERIC_DATE = `(?:\\d{4}[-./年]\\d{1,2}[-./月]\\d{1,2}日?|\\d{1,2}\\.\\s?\\d{1,2}\\.\\s?\\d{2,4})(?:\\s*[(（]?${WEEKDAY}[)）]?)?(?:\\s+\\d{1,2}(?::|時)\\d{2}分?)?`;
export const NUMERIC_DATELINE = new RegExp(`^${NUMERIC_DATE}(?:\\s+${NUMERIC_DATE}){0,2}$`, "u");
