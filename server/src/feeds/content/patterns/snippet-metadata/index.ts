import de from "./de.js";
import en from "./en.js";
import ja from "./ja.js";

export const SNIPPET_BYLINES = [...de, ...en, ...ja];
/** File names and copyright notices are metadata only when they stand alone before the text. */
export const SNIPPET_IMAGE_METADATA = [
  /^[\p{L}\p{N}_. -]{3,120}\.(?:jpe?g|png|webp|gif|avif)$/iu,
  /^(?:©|\(c\)|copyright(?:\s*©)?)\s*[^.!?\n]{1,100}$/iu,
];
