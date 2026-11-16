import * as de from "./de.js";
import * as en from "./en.js";
import * as ja from "./ja.js";

/** One file per language, searched all at once. To add a language, add a file next to these and list it here. */
export const BOILERPLATE_ANYWHERE: readonly RegExp[] = [de.ANYWHERE, en.ANYWHERE, ja.ANYWHERE].flat();
export const BOILERPLATE_TRAILING: readonly RegExp[] = [de.TRAILING, en.TRAILING, ja.TRAILING].flat();
export const BOILERPLATE_NEWSLETTER: readonly RegExp[] = [de.NEWSLETTER_BOX, en.NEWSLETTER_BOX, ja.NEWSLETTER_BOX].flat();
export const BOILERPLATE_ORPHAN_HEADINGS: readonly RegExp[] = [de.ORPHAN_HEADINGS, en.ORPHAN_HEADINGS, ja.ORPHAN_HEADINGS].flat();
