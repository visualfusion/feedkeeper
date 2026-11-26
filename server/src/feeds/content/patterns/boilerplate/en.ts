/**
 * Blocks, in English, that publishers put into their text without being part of the story. A block counts only when its whole text is one
 * of these lines (see `noise/boilerplate.ts`), so a sentence of the story that contains the words stays.
 */
export const ANYWHERE: readonly RegExp[] = [
  // Calls to follow the site on Google or elsewhere.
  /^(?:Follow us|Follow [^.!?]{2,40}) on Google(?: News| Discover)?$/i,
  /^Add(?: [^.!?]{2,50})? as a preferred (?:source|publisher)(?: on Google)?[^.!?]{0,80}\.?$/i,
  // The text of download buttons whose picture is gone.
  /^(?:Download on the (?:App|Mac App) Store|Get it on Google Play|Available on Google Play|[^.!?]{2,40} (?:for Android )?on Google Play)$/i,
  // A picture's filename shown as text.
  /^[\w\-. ]{3,120}\.(?:jpe?g|png|webp|gif|avif)$/i,
  // Newsletter footer chrome (Substack, Ghost, Beehiiv): action links and sign-off lines that arrive inside the article body.
  /^(?:View (?:this email |it )?in (?:your )?browser|Subscribe(?: now| here| to [^.!?]{1,80})?|Share(?: this (?:post|article|story))?|Unsubscribe(?: here)?|Get the app|Leave a comment)\.?$/i,
  /^Forwarded this email\?(?:\s+Subscribe[^.!?]{0,80}\.?)?$/i,
  /^You(?:'re| are) receiving this (?:email )?because you subscribed to [^.!?]{1,80}\.?$/i,
];

/** Orphaned recommendation headings without a following list. */
export const ORPHAN_HEADINGS: readonly RegExp[] = [
  /^(?:Top Stories|Trending(?: Now| Stories)?|More (?:Stories|Articles)|Related (?:Articles|Stories|Posts)|Most (?:Read|Popular)|Recommended(?: for you)?)$/i,
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
  // Author social follow lines at the end of an article.
  /^Follow [^.!?]{1,60}:\s*(?:X(?:\s*\/\s*Twitter)?|Twitter|Bluesky|Mastodon|Threads|Instagram|Facebook|YouTube|LinkedIn|TikTok|RSS)\b.{0,120}$/i,
  ...ORPHAN_HEADINGS,
  // Calls at the end of an article to follow on Google News or download the app.
  /^(?:Want more [^.!?]{2,50}\?\s*)?(?:Then\s+)?follow\s+[^.!?]{2,50}\s+on\s+Google(?:\s+News|\s+Discover)?(?:\s+or\s+(?:get|download)\s+our\s+app)?\.?$/i,
];

/** Copy of a newsletter signup box (container with a form before Readability, or orphaned box afterwards). */
export const NEWSLETTER_BOX: readonly RegExp[] = [
  /(?:\b(?:daily|weekly|monthly|free)\b.{0,30}newsletter|\bnewsletter.{0,120}(?:inbox|e-?mail|subscribe|sign up|free))/i,
];
