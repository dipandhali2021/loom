import type { Message } from '../store/types';

/**
 * A conversation as shareable plain text.
 *
 * Text rather than a link, because there is no link: nothing on the server publishes
 * a conversation, and a share sheet that produced a URL only the author can open
 * would be worse than one that produced the words. Plain text also goes everywhere
 * the sheet offers -- Notes, Mail, a message, a file -- with no server involved.
 *
 * Attachments are named, not embedded: the photos live behind pipeline URLs that
 * expire, and a line saying which file the question was about survives being pasted
 * somewhere in a year's time.
 */

/** Who each turn is labelled as. The app's own name, as the user knows it. */
const SPEAKER = { user: 'You', assistant: 'Loom' } as const;

/** Blank line between turns; the labels are what separates them, not indentation. */
const TURN_GAP = '\n\n';

export function toShareText(title: string, messages: Message[]): string {
  const turns = messages
    // A reply still streaming, or one that failed before it wrote anything, has no
    // text to share -- and a dangling "Loom:" reads as the transcript being cut off.
    .filter((message) => message.text.trim().length > 0 || (message.attachments?.length ?? 0) > 0)
    .map((message) => {
      const attached = message.attachments ?? [];
      const lines = [`${SPEAKER[message.role]}:`, message.text.trim()].filter(Boolean);
      if (attached.length > 0) {
        lines.push(`[Attached: ${attached.map((a) => a.name).join(', ')}]`);
      }
      return lines.join('\n');
    });

  // The title first, so a pasted transcript says what it is before it says anything
  // else. Omitted when it is the placeholder, which names nothing.
  const heading = title && title !== 'New chat' ? [title] : [];
  return [...heading, ...turns].join(TURN_GAP);
}
