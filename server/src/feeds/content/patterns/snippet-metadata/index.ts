import de, { markers as deMarkers } from "./de.js";
import en, { markers as enMarkers } from "./en.js";
import ja, { markers as jaMarkers } from "./ja.js";

export const SNIPPET_BYLINES = [...de, ...en, ...ja];
export const SNIPPET_MARKERS = [...deMarkers, ...enMarkers, ...jaMarkers];
/** File names and copyright notices are metadata only when they stand alone before the text. */
export const SNIPPET_IMAGE_FILENAME = /^[\p{L}\p{N}_. -]{3,120}\.(?:jpe?g|png|webp|gif|avif)$/iu;
export const SNIPPET_IMAGE_CREDIT = /^(?:©|\(c\)|copyright(?:\s*©)?)\s*[^!?\n]{1,100}$/iu;
export const SNIPPET_IMAGE_METADATA = [
  SNIPPET_IMAGE_FILENAME,
  /^(?:©|\(c\)|copyright(?:\s*©)?)\s*[^.!?\n]{1,100}$/iu,
];
