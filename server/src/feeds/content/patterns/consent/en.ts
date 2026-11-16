/** Consent notices that sit where an embed would be, in English. See `de.ts` for what the two lists mean. */
export default {
  anchors: [
    /^(?:Recommended|Featured) editorial content\b/i,
    /^External content$/i,
    /^Content from (?:YouTube|Vimeo|Instagram|X|Twitter|TikTok|Spotify|Facebook)\b/i,
    /^(?:Show|Load|Allow) external content$/i,
    /Here you can find external content from/i,
    /With your consent,?\s+(?:an? )?external .{0,60}(?:will be|is) loaded/i,
  ],
  companions: [
    /\bI agree (?:to|that) .{0,80}(?:external|third[- ]party) content/i,
    /\bPersonal data (?:may|can|will) be (?:transmitted|transferred|shared) to third[- ]part/i,
    /^(?:Show|Load|Allow|Display) content$/i,
    /\bMore information in our privacy policy/i,
  ],
};
