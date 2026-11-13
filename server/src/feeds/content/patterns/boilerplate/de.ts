/**
 * Blocks, in German, that publishers put into their text without being part of the story. A block counts only when its whole text is one
 * of these lines (see `noise/boilerplate.ts`), so a sentence of the story that contains the words stays.
 */
export const ANYWHERE: readonly RegExp[] = [
  // Aufrufe, der Seite bei Google oder in anderen Diensten zu folgen.
  /^(?:Uns|Folge uns|Folgen Sie uns) (?:auf|bei) Google(?: News| Discover)? folgen$/i,
  /^(?:Wähle|Wählen Sie|Füge|Fügen Sie) [^.!?]{2,50} (?:als )?(?:bevorzugte|bevorzugten|bevorzugter)\b[^.!?]{0,30}$/i,
  // „Als bevorzugte Quelle bei Google hinzufügen“, ohne den Namen der Seite.
  /^Als bevorzugte[nr]? (?:Google-)?Quelle (?:bei Google )?(?:hinzufügen|auswählen|wählen)$/i,
  // „★ ifun.de bei Google bevorzugen ★“ und ähnliche Bitten, die Seite als bevorzugte Quelle zu wählen.
  /^★?\s*[^★!?]{2,40} bei Google bevorzugen\s*★?$/i,
  // Texte von Download-Schaltflächen, deren Grafik nicht mehr da ist.
  /^(?:Laden im (?:App|Mac App|Google Play) Store|Im (?:App|Mac App) Store laden|Jetzt bei Google Play|Bei Google Play herunterladen|Laden bei Google Play)$/i,
  // Der Dateiname eines Bildes, den ein Link oder eine Beschriftung als Text zeigt.
  /^[\w\-. ]{3,120}\.(?:jpe?g|png|webp|gif|avif)$/i,
];

/** Fußzeilen am Ende des Textes; sie zählen nur in der zweiten Hälfte. */
export const TRAILING: readonly RegExp[] = [
  /^(?:Der Beitrag|Dieser Beitrag|Der Artikel|Dieser Artikel) .{3,200} (?:erschien|erschien zuerst|erschien erstmals) (?:zuerst )?(?:auf|bei) .{2,60}$/i,
  /^Der Beitrag .{3,200} wurde (?:zuerst|erstmals) (?:auf|bei) .{2,60} veröffentlicht\.?$/i,
  /^Diskutiere (?:diesen|den) (?:Artikel|Beitrag) .{0,40}$/i,
];
