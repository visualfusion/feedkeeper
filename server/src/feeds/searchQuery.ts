export interface ParsedSearchQuery {
  textQuery: string;
  hasAudio: boolean;
  hasVideo: boolean;
  hasMedia: boolean;
  hasNotes: boolean;
  readState: "unread" | "read" | null;
  starredOnly: boolean;
  feedTerms: string[];
  hasOperators: boolean;
}

function tokenizeSearchQuery(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const tokens: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]!;
    if (ch === "\"") {
      inQuotes = !inQuotes;
      current += ch;
    } else if (!inQuotes && /\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

/**
 * Splits a search query into structured filter operators (`has:audio`, `has:video`,
 * `has:notes`, `has:media`, `is:unread`, `is:read`, `is:starred`, `feed:...`)
 * and the remaining free-text search string.
 */
export function parseSearchQuery(raw: string): ParsedSearchQuery {
  const result: ParsedSearchQuery = {
    textQuery: "",
    hasAudio: false,
    hasVideo: false,
    hasMedia: false,
    hasNotes: false,
    readState: null,
    starredOnly: false,
    feedTerms: [],
    hasOperators: false,
  };

  const textParts: string[] = [];
  const tokens = tokenizeSearchQuery(raw);

  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (lower === "has:audio") {
      result.hasAudio = true;
      result.hasOperators = true;
    } else if (lower === "has:video") {
      result.hasVideo = true;
      result.hasOperators = true;
    } else if (lower === "has:media") {
      result.hasMedia = true;
      result.hasOperators = true;
    } else if (lower === "has:notes" || lower === "has:note") {
      result.hasNotes = true;
      result.hasOperators = true;
    } else if (lower === "is:unread") {
      result.readState = "unread";
      result.hasOperators = true;
    } else if (lower === "is:read") {
      result.readState = "read";
      result.hasOperators = true;
    } else if (lower === "is:starred" || lower === "is:bookmarked" || lower === "is:saved") {
      result.starredOnly = true;
      result.hasOperators = true;
    } else if (lower.startsWith("feed:")) {
      const value = token.slice(5).replace(/^"(.*)"$/, "$1").trim();
      if (value) {
        result.feedTerms.push(value);
        result.hasOperators = true;
      } else {
        textParts.push(token);
      }
    } else {
      textParts.push(token);
    }
  }

  result.textQuery = textParts.join(" ").trim();
  return result;
}

/** Appends SQL WHERE conditions for parsed search operators (expects `items i`, `subscriptions s`, `item_reads r`, `item_bookmarks b`). */
export function appendSearchOperatorConditions(
  parsed: ParsedSearchQuery,
  userId: number,
  conditions: string[],
  params: unknown[],
): void {
  if (parsed.hasAudio && parsed.hasVideo) {
    conditions.push("i.enclosure_url IS NOT NULL");
  } else if (parsed.hasAudio) {
    conditions.push("(i.enclosure_url IS NOT NULL AND (i.enclosure_type IS NULL OR LOWER(i.enclosure_type) NOT LIKE 'video/%'))");
  } else if (parsed.hasVideo) {
    conditions.push("(i.enclosure_url IS NOT NULL AND LOWER(i.enclosure_type) LIKE 'video/%')");
  } else if (parsed.hasMedia) {
    conditions.push("i.enclosure_url IS NOT NULL");
  }

  if (parsed.hasNotes) {
    conditions.push("i.id IN (SELECT item_id FROM item_notes WHERE user_id = ?)");
    params.push(userId);
  }
  if (parsed.readState === "unread") {
    conditions.push("r.item_id IS NULL");
  } else if (parsed.readState === "read") {
    conditions.push("r.item_id IS NOT NULL");
  }
  if (parsed.starredOnly) {
    conditions.push("b.item_id IS NOT NULL");
  }
  for (const term of parsed.feedTerms.slice(0, 3)) {
    const pattern = `%${term.toLowerCase()}%`;
    conditions.push(
      "EXISTS (SELECT 1 FROM feeds f_op WHERE f_op.id = i.feed_id AND (LOWER(COALESCE(NULLIF(TRIM(s.label), ''), NULLIF(TRIM(f_op.title), ''), f_op.url)) LIKE ? OR LOWER(f_op.url) LIKE ?))",
    );
    params.push(pattern, pattern);
  }
}
