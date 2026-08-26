import type { Request, Response } from 'express';
import { z } from 'zod';

import { streamChatCompletion } from '../ai.ts';
import { currentUser } from '../auth.ts';
import { prisma } from '../db.ts';
import { toMessageDTO } from '../dto.ts';
import { aiModels, appModelIds } from '../env.ts';
import { HttpError, notFound, parseBody } from '../http.ts';
import { HISTORY_LIMIT, systemPrompt, toChatMessages } from '../prompt.ts';
import { openStream, send } from '../sse.ts';

/**
 * POST /api/v1/conversations/:conversationId/completions
 *
 * One request covers the whole turn: it stores the user's message, streams the
 * reply back as server-sent events, and stores the assistant message as it
 * completes. Doing it in one call is what makes the reply survive the app being
 * backgrounded -- the row is already there to re-read.
 */

const CompletionBody = z.object({
  text: z.string().trim().min(1).max(32_000),
  /** The app's tier, not a provider model id; env.ts maps it. */
  model: z.enum(appModelIds).default('gpt-5'),
  /**
   * Re-answer into an existing assistant row instead of appending a turn. Without
   * this, "regenerate" would store the same question twice and the next reply
   * would be generated with the rejected one still in its history.
   */
  regenerateMessageId: z.uuid().optional(),
});

/** First line of the opening message, trimmed to something that fits a list row. */
function deriveTitle(text: string): string {
  const line =
    text
      .split('\n')
      .find((part) => part.trim().length > 0)
      ?.trim() ?? '';
  const clipped = line.length > 60 ? `${line.slice(0, 57).trimEnd()}…` : line;
  return clipped || 'New chat';
}

export async function postCompletion(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const parsedId = z.uuid().safeParse(req.params.conversationId);
  if (!parsedId.success) throw notFound('Conversation not found.');
  const conversationId = parsedId.data;

  const body = parseBody(CompletionBody, req.body);

  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId: user.id },
    select: { id: true, title: true },
  });
  if (!conversation) throw notFound('Conversation not found.');

  const profile = await prisma.agentProfile.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id },
  });

  /*
   * The reply being replaced, when regenerating. Its timestamp is the cutoff for
   * history, so the rejected answer and everything after it are excluded.
   */
  const replacing = body.regenerateMessageId
    ? await prisma.message.findFirst({
        where: { id: body.regenerateMessageId, conversationId, role: 'assistant' },
        select: { id: true, createdAt: true },
      })
    : null;
  if (body.regenerateMessageId && !replacing) throw notFound('Message not found.');

  /*
   * Read history BEFORE inserting the new turn, then append it -- selecting
   * afterwards would need a second query to exclude the row just written, and
   * ordering by createdAt cannot separate two rows written in the same tick.
   */
  const history = await prisma.message.findMany({
    where: {
      conversationId,
      role: { in: ['user', 'assistant'] },
      status: 'complete',
      ...(replacing ? { createdAt: { lt: replacing.createdAt } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: HISTORY_LIMIT,
    select: { role: true, content: true },
  });

  const now = new Date();
  const model = aiModels[body.model];

  /*
   * Regenerating: the question is already stored, and its own row is the one being
   * rewritten. Everything after it was answered in reply to the rejected text, so
   * it goes too -- leaving it would strand turns beneath a reply that no longer exists.
   */
  if (replacing) {
    await prisma.$transaction([
      prisma.message.deleteMany({
        where: { conversationId, createdAt: { gt: replacing.createdAt } },
      }),
      prisma.message.update({
        where: { id: replacing.id },
        data: { content: '', status: 'incomplete', model, inputTokens: null, outputTokens: null },
      }),
      prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: now } }),
    ]);
  }

  // Both rows, plus the title, land in one transaction: a stored user message with
  // no assistant row to stream into would leave the app with a turn it cannot finish.
  const { userMessage, assistantMessage } = replacing
    ? { userMessage: null, assistantMessage: { id: replacing.id } }
    : await prisma.$transaction(async (tx) => {
        const stored = await tx.message.create({
          data: { conversationId, role: 'user', content: body.text, status: 'complete' },
        });
        const placeholder = await tx.message.create({
          data: { conversationId, role: 'assistant', content: '', status: 'incomplete', model },
        });
        await tx.conversation.update({
          where: { id: conversationId },
          data: {
            updatedAt: now,
            // Name the conversation from its opening message, once.
            ...(conversation.title ? {} : { title: deriveTitle(body.text) }),
          },
        });
        return { userMessage: stored, assistantMessage: placeholder };
      });

  openStream(res);

  // No 'user' frame when regenerating: the client already has that message.
  if (userMessage) send(res, { type: 'user', message: toMessageDTO(userMessage) });
  send(res, { type: 'assistant', id: assistantMessage.id });

  /*
   * The client going away has to reach the upstream request, or an abandoned
   * reply keeps generating (and billing) with nobody reading it.
   */
  const clientGone = new AbortController();
  res.on('close', () => clientGone.abort());

  let result;
  try {
    result = await streamChatCompletion({
      model,
      messages: [
        { role: 'system', content: systemPrompt(profile) },
        ...toChatMessages(history.reverse()),
        { role: 'user', content: body.text },
      ],
      onDelta: (delta) => send(res, { type: 'delta', text: delta }),
      signal: clientGone.signal,
    });
  } catch (error) {
    /*
     * Headers are already out, so the error handler cannot turn this into a JSON
     * 502. Mark the row failed and report it in-band instead -- an assistant row
     * left `incomplete` forever would show as a reply still streaming.
     */
    await prisma.message
      .update({ where: { id: assistantMessage.id }, data: { status: 'failed' } })
      .catch(() => {});

    const message =
      error instanceof HttpError ? error.message : 'Something went wrong generating the reply.';
    console.error('[completions] generation failed', error);
    send(res, { type: 'error', message, messageId: assistantMessage.id });
    res.end();
    return;
  }

  const finished = await prisma.$transaction(async (tx) => {
    const updated = await tx.message.update({
      where: { id: assistantMessage.id },
      data: {
        content: result.text,
        /*
         * An aborted or truncated reply keeps whatever text arrived but stays
         * `incomplete`, which the app renders as a partial turn rather than
         * passing off as a finished answer.
         */
        status: result.finishReason === 'stop' ? 'complete' : 'incomplete',
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      },
    });
    await tx.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });
    return updated;
  });

  send(res, { type: 'done', message: toMessageDTO(finished), finishReason: result.finishReason });
  res.end();
}
