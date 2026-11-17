/** Lines that only restate what a reader's head already shows, in German. See `en.ts`. */
export default {
  weekdays: ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"],
  relativeAges: [/^vor\s+(?:\d{1,3}|einer|einem)\s*(?:Sekunden?|Sek\.|Minuten?|Min\.|Stunden?|Std\.|Tagen?|Wochen?)$/i, /^(?:gerade eben|soeben|eben erst)$/i],
  kickers: [/^(?:NEWS|News|Nachrichten|Meldung|Kolumne|Rezension|Interview)\s*[|｜/／·•]\s*[^.!?。！？]{1,40}$/],
};
