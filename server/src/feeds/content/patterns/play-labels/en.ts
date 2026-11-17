/**
 * Alt texts of play-button pictures. A picture with one of them is the button of a player, not an illustration, and goes
 * with the player. Whole texts only: a sentence that merely contains "play" is never a label.
 */
export default ["play", "play video", "watch", "watch video", "start video"];

/** Titles a player's frame carries as a technical name, not as the name of the video: `vimeo-player`, `YouTube video player`. */
export const PLAYER_TITLES = [/^[\w. -]{0,30}[ -]?player$/i];
