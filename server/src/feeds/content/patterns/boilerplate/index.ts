import * as de from "./de.js";
import * as en from "./en.js";
import * as ja from "./ja.js";

/** One file per language, searched all at once. To add a language, add a file next to these and list it here. */
export const BOILERPLATE_ANYWHERE: readonly RegExp[] = [de.ANYWHERE, en.ANYWHERE, ja.ANYWHERE].flat();
export const BOILERPLATE_TRAILING: readonly RegExp[] = [de.TRAILING, en.TRAILING, ja.TRAILING].flat();
