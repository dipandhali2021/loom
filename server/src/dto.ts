import type {
  AgentProfile,
  AgentTone,
  AgentVerbosity,
  Conversation,
  Message,
  MessageRole,
} from './generated/prisma/client.ts';

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

export type MessageDTO = {
  id: string;
  role: ClientRole;
  text: string;
  pending?: boolean;
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

export function toMessageDTO(message: Message): MessageDTO {
  return {
    id: message.id,
    role: message.role === 'assistant' ? 'assistant' : 'user',
    text: message.content,
    // Only send the flag when it is true; the app treats it as optional.
    ...(message.status === 'complete' ? {} : { pending: true }),
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
