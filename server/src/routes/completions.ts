import type { Request, Response } from 'express';
import { z } from 'zod';

import { runTurn } from '../agent.ts';
import { AttachmentsSchema, toContentParts } from '../attachments.ts';
import { currentUser } from '../auth.ts';
import { prisma } from '../db.ts';
import { toMessageDTO } from '../dto.ts';
import { aiModels, appModelIds, webSearchEnabled } from '../env.ts';
import { HttpError, notFound, parseBody } from '../http.ts';
import { Prisma } from '../generated/prisma/client.ts';
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
  /**
   * The composer's web-search switch. Per turn rather than per conversation: it is a
   * property of the question ("what shipped this week") and not of the chat, and the
   * user flips it in the same sheet they attach a file from.
   *
   * A request asking for it on a server with WEB_SEARCH="false" is not an error -- the
   * turn simply runs without the tool, the way it did before there was one.
   */
  search: z.boolean().default(false),
  /**
   * Photos and files the composer attached, as the /uploads route returned them.
   *
   * URLs and extracted text, not bytes: the file went to the upload pipeline
   * directly, so what arrives here is small enough to sit inside the 1MB JSON limit
   * app.ts sets. Every field is re-validated (attachments.ts) rather than trusted --
   * the client could post any URL it liked, and only the pipeline's own hosts are
   * accepted.
   */
  attachments: AttachmentsSchema.default([]),
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
    // `attachments` too: a follow-up question about a photo needs the photo, and
    // toChatMessages decides how many of them are worth re-sending.
    select: { role: true, content: true, attachments: true },
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
        /*
         * `sources: null` matters as much as the empty content: a re-answer that does
         * not search must not keep the citations of the reply it replaced, which would
         * leave links under an answer that never consulted them.
         */
        data: {
          content: '',
          status: 'incomplete',
          model,
          inputTokens: null,
          outputTokens: null,
          sources: Prisma.DbNull,
        },
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
          data: {
            conversationId,
            role: 'user',
            content: body.text,
            status: 'complete',
            /*
             * Stored so a reload shows the turn with its attachments still on it. Only
             * when there are some: `DbNull` keeps "sent before attachments existed"
             * distinct from "sent with none", the way `sources` does.
             */
            attachments: body.attachments.length > 0 ? body.attachments : Prisma.DbNull,
          },
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

  /*
   * The tool is offered only when the user asked for it *and* the server has it on.
   * Both halves are checked here rather than inside the loop, so a turn that is not
   * searching takes exactly the path it took before this feature existed.
   */
  const searchAllowed = body.search && webSearchEnabled;

  let result;
  try {
    result = await runTurn({
      model,
      messages: [
        { role: 'system', content: systemPrompt(profile, searchAllowed) },
        ...toChatMessages(history.reverse()),
        /*
         * A plain string when nothing is attached, an array of parts when something is
         * -- which is what carries an image to the model as a URL it fetches rather
         * than as text. Attached document text is fenced as data inside it; see
         * toContentParts.
         */
        { role: 'user', content: toContentParts(body.text, body.attachments) },
      ],
      searchAllowed,
      onDelta: (delta) => send(res, { type: 'delta', text: delta }),
      /*
       * Forwarded as it happens, not summarised at the end: the whole point is that
       * the wait -- which a search makes several seconds longer -- says what it is
       * waiting for. The client's thinking indicator reads these.
       */
      onTool: (event) => send(res, { type: 'tool', ...event }),
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
        /*
         * Only written when a search ran. Left alone otherwise, so a regenerate that
         * does not search clears the old citations (above) and an ordinary turn never
         * touches the column at all.
         */
        ...(result.searches > 0 ? { sources: result.sources } : {}),
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
