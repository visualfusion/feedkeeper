/**
 * Blocks, in English, that publishers put into their text without being part of the story. A block counts only when its whole text is one
 * of these lines (see `noise/boilerplate.ts`), so a sentence of the story that contains the words stays.
 */
export const ANYWHERE: readonly RegExp[] = [
  // Calls to follow the site on Google or elsewhere.
  /^(?:Follow us on Google(?: News| Discover)?|Add(?: [^.!?]{2,50})? as a preferred (?:source|publisher)(?: on Google)?)$/i,
  // The text of download buttons whose picture is gone.
  /^(?:Download on the (?:App|Mac App) Store|Get it on Google Play|Available on Google Play)$/i,
];

/** Footers at the end of the text; they count only in the second half. */
export const TRAILING: readonly RegExp[] = [
  /^(?:This (?:article|post)|The post),? .{3,200} (?:first )?appeared (?:first )?on .{2,60}$/i,
  /^Discuss this (?:article|story|post)\b.{0,40}$/i,
  // MacRumors: the related links under every article.
  /^Related Roundups?:.{0,300}$/i,
  /^(?:Tag|Tags|Buyer's Guides?|Related Forums?):.{0,200}$/i,
  // The Verge: the box that offers to follow the story's topics and authors.
  /^Follow topics and authors from this story\b.{0,200}$/i,
];
