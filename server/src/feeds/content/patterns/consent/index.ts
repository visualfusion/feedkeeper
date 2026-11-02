import de from "./de.js";
import en from "./en.js";
import ja from "./ja.js";

/**
 * One file per language. A notice is looked for in every language at once, because an article in one language can
 * sit on a site in another. To add a language, add a file next to these and list it here.
 */
const LANGUAGES = [de, en, ja];

export const CONSENT_ANCHORS: readonly RegExp[] = LANGUAGES.flatMap(language => language.anchors);
export const CONSENT_COMPANIONS: readonly RegExp[] = LANGUAGES.flatMap(language => language.companions);
