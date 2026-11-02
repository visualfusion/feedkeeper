import de from "./de.js";
import en from "./en.js";
import ja from "./ja.js";

/** One file per language, searched all at once. To add a language, add a file next to these and list it here. */
export const LOADING_LABELS: readonly RegExp[] = [de, en, ja].flat();
