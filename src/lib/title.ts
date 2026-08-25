/**
 * Conversation titles as the history list shows them.
 *
 * The server derives a title too, from the same opening message. This is the
 * optimistic copy: the row appears in the drawer the moment the user hits send,
 * before any response has come back to name it.
 */
export function deriveTitle(firstMessage: string): string {
  const clean = firstMessage.replace(/\s+/g, ' ').trim();
  if (clean.length <= 38) return clean || 'New chat';
  return `${clean.slice(0, 38).trimEnd()}…`;
}
