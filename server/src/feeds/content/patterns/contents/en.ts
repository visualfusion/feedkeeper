/**
 * Headings, in English, that introduce a table of contents. A script builds the list under such a heading on many sites; without the
 * script only the heading is left. The whole text of the heading must be one of these (see `noise/emptyContents.ts`).
 */
export default [
  /^(?:table of contents|contents|in this (?:article|guide|post|story)|on this page|jump to)\s*:?$/i,
];
