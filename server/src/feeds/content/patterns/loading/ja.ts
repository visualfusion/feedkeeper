/**
 * Whole-line placeholders, in Japanese, that a script replaces with content. A reader that does not run the script
 * keeps them as text. Only a block that holds nothing else counts.
 */
export default [
  /^(?:読み込み中|ロード中|少々お待ちください)(?:\s*(?:\.{3}|…))?$/i,
];
