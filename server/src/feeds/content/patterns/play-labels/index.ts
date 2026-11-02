import de from "./de.js";
import en from "./en.js";
import ja from "./ja.js";

/** One file per language, searched all at once. To add a language, add a file next to these and list it here. */
export const PLAY_LABEL = new RegExp(`^(?:${[de, en, ja].flat().map(label => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})$`, "i");
