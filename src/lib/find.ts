/**
 * Find in chat: where a query occurs in a transcript.
 *
 * Plain case-insensitive substring matching, not a regex — the query is whatever
 * someone typed into a search field, and `.*` there should look for a dot, a star
 * and nothing clever. Non-overlapping and left to right, so "aa" in "aaa" is one
 * match rather than two, which is what a match count has to mean for the chevrons
 * to walk through it.
 *
 * Offsets are into the message's own text, which for an assistant turn is its
 * Markdown source rather than what is drawn. A query that straddles syntax
 * ("*bold*" searched for as "bold*") therefore counts here and highlights only in
 * part. That is the right trade: the alternative is a second parse whose offsets
 * would have to be mapped back to make navigation work at all.
 */

/** One occurrence, as offsets into the text it was found in. */
export type Range = [start: number, end: number];

/** One occurrence in a transcript, with the turn it belongs to. */
export type FindMatch = {
  messageId: string;
  /** Offset into that message's text. */
  start: number;
};

/**
 * Every occurrence of `query` in `text`, left to right and non-overlapping.
 *
 * Called per rendered run as well as per message, so it stays a plain `indexOf`
 * walk over a lowercased copy rather than anything that allocates per character.
 */
export function matchRanges(text: string, query: string): Range[] {
  if (query.length === 0) return [];
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();

  const out: Range[] = [];
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    out.push([at, at + needle.length]);
    at = haystack.indexOf(needle, at + needle.length);
  }
  return out;
}

/**
 * Every occurrence across a transcript, in reading order.
 *
 * Flat rather than grouped by message: the chevrons step through hits, and which
 * turn a hit lives in is a property of the hit, not the unit being counted.
 */
export function findMatches(
  messages: { id: string; text: string }[],
  query: string,
): FindMatch[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  return messages.flatMap((message) =>
    matchRanges(message.text, trimmed).map(([start]) => ({ messageId: message.id, start })),
  );
}
