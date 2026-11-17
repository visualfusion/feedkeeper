/**
 * Lines that only restate what a reader's head already shows, in English. A line counts only whole and only near the
 * start of the text; a sentence that merely contains a weekday or "ago" is never matched.
 */
export default {
  weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
  /** How long ago the page was published: `4 minutes ago`, `just now`. */
  relativeAges: [/^\d{1,3}\s*(?:seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?)\s+ago$/i, /^(?:just now|moments? ago)$/i],
  /** A section label in front of the story: `NEWS | Sound / Exhibition`. */
  kickers: [/^(?:NEWS|News|Feature|Column|Review|Opinion|Interview)\s*[|｜/／·•]\s*[^.!?。！？]{1,40}$/],
};
