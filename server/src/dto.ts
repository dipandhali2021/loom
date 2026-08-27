import type {
  AgentProfile,
  AgentTone,
  AgentVerbosity,
  Conversation,
  Message,
  MessageRole,
} from './generated/prisma/client.ts';
import { AttachmentsSchema, type Attachment } from './attachments.ts';

/**
 * The database and the app speak slightly different dialects. Translation happens
 * here, in one place, so route handlers never leak column names to the client:
 *
 *   DB `content`            -> app `text`
 *   DB `status`             -> app `pending`
 *   DB `Date` timestamps    -> app epoch milliseconds
 *   DB role `system`        -> hidden from the client entirely
 *
 * `archived` has no column in the existing schema, so it is always reported as
 * false. Persisting it needs a migration, which this pass deliberately does not do.
 */

/** Roles the app knows about (src/store/types.ts). `system` is internal-only. */
export type ClientRole = 'user' | 'assistant';

/**
 * One web page a reply cited, as the app renders it in the source list under the turn.
 *
 * A narrower shape than the search result it came from: rank, score and the provider's
 * raw payload are retrieval detail with nothing to show, and `fetched` is the one bit
 * the UI needs -- a source whose page was read is quotable, one that is only a link
 * was found but not opened.
 */
export type SourceDTO = {
  title: string;
  url: string;
  displayUrl: string;
  publishedAt: string | null;
  fetched: boolean;
};

export type MessageDTO = {
  id: string;
  role: ClientRole;
  text: string;
  pending?: boolean;
  /** Present only on a reply that actually searched. */
  sources?: SourceDTO[];
  /** Present only on a turn the user attached something to. */
  attachments?: Attachment[];
  createdAt: number;
};

export type ConversationDTO = {
  id: string;
  title: string;
  messages: MessageDTO[];
  createdAt: number;
  updatedAt: number;
  archived: boolean;
};

/**
 * What the conversation list returns. Deliberately excludes `messages`: sending
 * every message of every conversation is an unbounded payload. Fetch one
 * conversation to get its messages.
 */
export type ConversationSummaryDTO = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
  messageCount: number;
  preview: string | null;
};

export type ProfileDTO = {
  displayName: string;
  tone: AgentTone;
  verbosity: AgentVerbosity;
  customInstructions: string;
  updatedAt: number;
};

export const isClientRole = (role: MessageRole): role is ClientRole =>
  role === 'user' || role === 'assistant';

/**
 * Reads the `sources` column back into the DTO shape.
 *
 * The column is `jsonb`, so what comes out is whatever went in -- including rows
 * written by an older build, or by hand. Each entry is checked field by field rather
 * than cast, because a malformed one would otherwise reach the app as a source with an
 * undefined url and render as a broken link.
 */
function toSourceDTOs(value: unknown): SourceDTO[] | null {
  if (!Array.isArray(value)) return null;
  const sources = value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const row = entry as Record<string, unknown>;
    if (typeof row.url !== 'string' || typeof row.title !== 'string') return [];
    return [
      {
        title: row.title,
        url: row.url,
        displayUrl: typeof row.displayUrl === 'string' ? row.displayUrl : row.url,
        publishedAt: typeof row.publishedAt === 'string' ? row.publishedAt : null,
        fetched: row.fetched === true,
      },
    ];
  });
  return sources.length > 0 ? sources : null;
}

/**
 * Reads the `attachments` column back into the DTO shape.
 *
 * Parsed with the same schema the upload route returns and the completions route
 * accepts, rather than cast: the column is `jsonb`, so a row written by an older build
 * -- or by hand -- would otherwise reach the app as an attachment with an undefined url
 * and render as a broken chip. A row that fails is dropped rather than repaired.
 */
function toAttachmentDTOs(value: unknown): Attachment[] | null {
  if (!Array.isArray(value)) return null;
  const parsed = AttachmentsSchema.safeParse(value);
  if (!parsed.success || parsed.data.length === 0) return null;
  return parsed.data;
}

export function toMessageDTO(message: Message): MessageDTO {
  const sources = toSourceDTOs(message.sources);
  const attachments = toAttachmentDTOs(message.attachments);
  return {
    id: message.id,
    role: message.role === 'assistant' ? 'assistant' : 'user',
    text: message.content,
    // Only send the flag when it is true; the app treats it as optional.
    ...(message.status === 'complete' ? {} : { pending: true }),
    ...(sources ? { sources } : {}),
    ...(attachments ? { attachments } : {}),
    createdAt: message.createdAt.getTime(),
  };
}

export function toConversationDTO(
  conversation: Conversation & { messages: Message[] },
): ConversationDTO {
  return {
    id: conversation.id,
    title: conversation.title ?? '',
    messages: conversation.messages.filter((m) => isClientRole(m.role)).map(toMessageDTO),
    createdAt: conversation.createdAt.getTime(),
    updatedAt: conversation.updatedAt.getTime(),
    archived: false,
  };
}

export function toConversationSummaryDTO(
  conversation: Conversation & {
    _count: { messages: number };
    messages: Pick<Message, 'content'>[];
  },
): ConversationSummaryDTO {
  return {
    id: conversation.id,
    title: conversation.title ?? '',
    createdAt: conversation.createdAt.getTime(),
    updatedAt: conversation.updatedAt.getTime(),
    archived: false,
    messageCount: conversation._count.messages,
    preview: conversation.messages[0]?.content ?? null,
  };
}

export function toProfileDTO(profile: AgentProfile): ProfileDTO {
  return {
    displayName: profile.displayName,
    tone: profile.tone,
    verbosity: profile.verbosity,
    customInstructions: profile.customInstructions,
    updatedAt: profile.updatedAt.getTime(),
  };
}
