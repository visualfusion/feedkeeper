/**
 * Consent notices that sit where an embed would be, in German. `anchors` start a notice (a block matching one is
 * removed), `companions` are the lines of the same notice that follow and go with it. A pattern belongs here only
 * when more than one site uses the wording; a single word like "Datenschutz" would also hit articles about it.
 */
export default {
  anchors: [
    /^Empfohlene[rn]? redaktionelle[rn]? Inhalte?\b/i,
    /^Ein Klick für den Datenschutz$/i,
    /An dieser Stelle (?:finden Sie|befindet sich) einen? .{0,60}externen? Inhalt/i,
    /Hier findest du externe Inhalte von/i,
    /An dieser Stelle findest du einen externen Inhalt/i,
    /Du kannst ihn dir mit einem Klick anzeigen lassen/i,
  ],
  companions: [
    /\bInhalte? (von \S+ )?erlauben\b/i,
    /-Inhalte erlauben\b/i,
    /Ich bin damit einverstanden, dass mir .{0,80} angezeigt (?:wird|werden)/i,
    /Erst wenn Sie (?:hier )?klicken, werden .{0,60}nachgeladen/i,
    /^Externen? Inhalt(?:e)? anzeigen$/i,
    /^Inhalte? (?:ansehen|anzeigen)$/i,
    /Personenbezogene Daten (?:können|werden) an Drittplattformen/i,
    /^Link zum .+-Inhalt$/i,
    /Mehr dazu in unserer Datenschutzerklärung/i,
  ],
};
