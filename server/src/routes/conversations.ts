import { Router } from 'express';
import { z } from 'zod';

import { currentUser } from '../auth.ts';
import { prisma } from '../db.ts';
import { toConversationDTO, toConversationSummaryDTO, toMessageDTO } from '../dto.ts';
import { notFound, parseBody, parseQuery } from '../http.ts';
import { postCompletion } from './completions.ts';

export const conversationsRouter = Router();

const Title = z.string().trim().max(200);

const CreateConversationBody = z.object({ title: Title.optional() });
const UpdateConversationBody = z.object({ title: Title.nullable() });

const ListMessagesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  /** Cursor: return only messages created after this message id. */
  after: z.uuid().optional(),
});

const CreateMessageBody = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string().max(32_000).default(''),
  model: z.string().max(80).optional(),
  /** True while an assistant reply is still streaming; stored as status=incomplete. */
  pending: z.boolean().optional(),
});

const UpdateMessageBody = z
  .object({
    text: z.string().max(32_000).optional(),
    pending: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update.',
  });

/**
 * A malformed uuid in the path is reported as 404, not 400 — "no such resource" is
 * the honest answer for a path segment, and it keeps Prisma from raising P2023.
 */
function pathId(value: string | undefined, label: string): string {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw notFound(`${label} not found.`);
  return parsed.data;
}

/**
 * Scopes every lookup by `userId`, so another account's conversation is
 * indistinguishable from one that does not exist. No 403, no existence leak.
 */
async function assertOwned(userId: string, conversationId: string): Promise<void> {
  const row = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
    select: { id: true },
  });
  if (!row) throw notFound('Conversation not found.');
}

/** `updated_at` is a plain default(now()) column, so writes must touch it by hand. */
const touch = { updatedAt: new Date() };

conversationsRouter.get('/', async (req, res) => {
  const user = currentUser(req);

  const rows = await prisma.conversation.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: 'desc' },
    include: {
      _count: { select: { messages: true } },
      messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { content: true } },
    },
  });

  res.json({ conversations: rows.map(toConversationSummaryDTO) });
});

conversationsRouter.post('/', async (req, res) => {
  const user = currentUser(req);
  const { title } = parseBody(CreateConversationBody, req.body ?? {});

  const conversation = await prisma.conversation.create({
    data: { userId: user.id, title: title ?? null },
    include: { messages: true },
  });

  res.status(201).json({ conversation: toConversationDTO(conversation) });
});

conversationsRouter.get('/:conversationId', async (req, res) => {
  const user = currentUser(req);
  const conversationId = pathId(req.params.conversationId, 'Conversation');

  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId: user.id },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  });
  if (!conversation) throw notFound('Conversation not found.');

  res.json({ conversation: toConversationDTO(conversation) });
});

conversationsRouter.patch('/:conversationId', async (req, res) => {
  const user = currentUser(req);
  const conversationId = pathId(req.params.conversationId, 'Conversation');
  const { title } = parseBody(UpdateConversationBody, req.body);

  await assertOwned(user.id, conversationId);

  const conversation = await prisma.conversation.update({
    where: { id: conversationId },
    data: { title, ...touch },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  });

  res.json({ conversation: toConversationDTO(conversation) });
});

conversationsRouter.delete('/:conversationId', async (req, res) => {
  const user = currentUser(req);
  const conversationId = pathId(req.params.conversationId, 'Conversation');

  await assertOwned(user.id, conversationId);
  // Messages go with it: the FK is ON DELETE CASCADE in the existing schema.
  await prisma.conversation.delete({ where: { id: conversationId } });

  res.status(204).end();
});

conversationsRouter.get('/:conversationId/messages', async (req, res) => {
  const user = currentUser(req);
  const conversationId = pathId(req.params.conversationId, 'Conversation');
  const { limit, after } = parseQuery(ListMessagesQuery, req.query);

  await assertOwned(user.id, conversationId);

  let createdAfter: Date | undefined;
  if (after) {
    const anchor = await prisma.message.findFirst({
      where: { id: after, conversationId },
      select: { createdAt: true },
    });
    if (!anchor) throw notFound('Cursor message not found.');
    createdAfter = anchor.createdAt;
  }

  const messages = await prisma.message.findMany({
    where: {
      conversationId,
      // `system` messages are internal; the app's Role union has no place for them.
      role: { in: ['user', 'assistant'] },
      ...(createdAfter ? { createdAt: { gt: createdAfter } } : {}),
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });

  res.json({
    messages: messages.map(toMessageDTO),
    nextCursor: messages.length === limit ? (messages.at(-1)?.id ?? null) : null,
  });
});

conversationsRouter.post('/:conversationId/messages', async (req, res) => {
  const user = currentUser(req);
  const conversationId = pathId(req.params.conversationId, 'Conversation');
  const body = parseBody(CreateMessageBody, req.body);

  await assertOwned(user.id, conversationId);

  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.message.create({
      data: {
        conversationId,
        role: body.role,
        content: body.text,
        status: body.pending ? 'incomplete' : 'complete',
        ...(body.model ? { model: body.model } : {}),
      },
    });
    // Keeps the conversation at the top of the list ordering.
    await tx.conversation.update({ where: { id: conversationId }, data: { ...touch } });
    return created;
  });

  res.status(201).json({ message: toMessageDTO(message) });
});

/**
 * The turn endpoint: stores the user message, streams the reply, stores it too.
 * The plain messages routes above stay for reads and edits.
 */
conversationsRouter.post('/:conversationId/completions', postCompletion);

conversationsRouter.patch('/:conversationId/messages/:messageId', async (req, res) => {
  const user = currentUser(req);
  const conversationId = pathId(req.params.conversationId, 'Conversation');
  const messageId = pathId(req.params.messageId, 'Message');
  const patch = parseBody(UpdateMessageBody, req.body);

  await assertOwned(user.id, conversationId);

  const existing = await prisma.message.findFirst({
    where: { id: messageId, conversationId },
    select: { id: true },
  });
  if (!existing) throw notFound('Message not found.');

  const [message] = await prisma.$transaction([
    prisma.message.update({
      where: { id: messageId },
      data: {
        ...(patch.text !== undefined ? { content: patch.text } : {}),
        ...(patch.pending !== undefined
          ? { status: patch.pending ? 'incomplete' : 'complete' }
          : {}),
      },
    }),
    prisma.conversation.update({ where: { id: conversationId }, data: { ...touch } }),
  ]);

  res.json({ message: toMessageDTO(message) });
});
