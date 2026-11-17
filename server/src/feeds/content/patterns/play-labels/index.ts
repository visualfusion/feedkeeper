import de, { PLAYER_TITLES as deTitles } from "./de.js";
import en, { PLAYER_TITLES as enTitles } from "./en.js";
import ja, { PLAYER_TITLES as jaTitles } from "./ja.js";

/** One file per language, searched all at once. To add a language, add a file next to these and list it here. */
export const PLAY_LABEL = new RegExp(`^(?:${[de, en, ja].flat().map(label => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})$`, "i");

/** A frame title that names the player technology rather than the video: the platform name is the better label then. */
export const PLAYER_TITLES: readonly RegExp[] = [...deTitles, ...enTitles, ...jaTitles];
