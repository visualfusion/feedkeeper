/**
 * Whole-line placeholders that a script replaces with content (a comment box, a gallery, a player). A reader that does not run the
 * script keeps them as text. Only a block that holds nothing else counts, so a sentence that contains the word stays.
 */
export default [
  /^(?:loading|please wait)(?:\s*(?:\.{3}|…))?$/i,
  // The heading of a comment box that a script fills.
  /^(?:what do you think(?: so far)?|join the (?:conversation|discussion))\??$/i,
];
