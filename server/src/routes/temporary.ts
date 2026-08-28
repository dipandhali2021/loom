import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { runTurn } from '../agent.ts';
import { AttachmentsSchema, toContentParts } from '../attachments.ts';
import { currentUser } from '../auth.ts';
import { prisma } from '../db.ts';
import { webSearchEnabled } from '../env.ts';
import type { AgentProfile } from '../generated/prisma/client.ts';
import { HttpError, parseBody } from '../http.ts';
import { resolveModel } from '../models.ts';
import { systemPrompt, toChatMessages } from '../prompt.ts';
import { openStream, send } from '../sse.ts';

/**
 * POST /api/v1/temporary/completions
 *
 * A reply that is never written down. Same stream, same model, same persona as
 * /conversations/:id/completions -- and no Conversation row, no Message rows, no
 * `updatedAt` touched anywhere.
 *
 * A separate route rather than a flag on the existing one. That handler stores both
 * turns in a transaction *before* the first token, and threads the ids it gets back
 * through every frame it emits and every update it makes afterwards; a `temporary`
 * branch through it would have to make each of those conditional, which is a lot of
 * places for a future edit to reintroduce a write. Here there is nothing to write in
 * the first place, so the property holds by construction rather than by care.
 *
 * The history the client sends is the only history there is -- the point of a
 * temporary chat is that the server kept no copy of the earlier turns either.
 *
 * Mounted behind `requireAuth` and `withUser` (routes/index.ts), like everything
 * under /api/v1: not storing a chat is not a reason to stop knowing whose it is,
 * and this route spends provider credits.
 */

export const temporaryRouter = Router();

/**
 * How many prior turns the client may replay.
 *
 * The same bound the stored path applies from its own table (HISTORY_LIMIT), but it
 * has to be enforced here too: this history arrives in the request body, so without
 * a cap a client could send an arbitrarily long conversation and pay for it in
 * provider tokens.
 */
const MAX_HISTORY = 30;

const TemporaryBody = z.object({
  text: z.string().trim().min(1).max(32_000),
  /** A model id from the proxy's catalog, as on the stored route. */
  model: z.string().min(1).optional(),
  /** Earlier turns of this temporary chat, oldest first. Nothing is stored, so
   * the client is the only thing holding them. */
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        text: z.string().max(32_000),
        /**
         * What that turn had attached, replayed from the client's own copy for the
         * same reason its text is. Validated exactly as the stored route validates
         * them -- a temporary chat is not a looser one.
         */
        attachments: AttachmentsSchema.default([]),
      }),
    )
    .max(MAX_HISTORY)
    .default([]),
  /** The composer's web-search switch, same as the stored route. */
  search: z.boolean().default(false),
  /** This turn's attachments, as /uploads returned them. Nothing is stored either way. */
  attachments: AttachmentsSchema.default([]),
});

export async function postTemporaryCompletion(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const body = parseBody(TemporaryBody, req.body);

  /*
   * `findUnique`, not the `upsert` the stored route uses. This request must leave
   * the database exactly as it found it, and a user who has never opened settings
   * has no profile row -- so the defaults stand in for one instead of being written.
   */
  const stored = await prisma.agentProfile.findUnique({ where: { userId: user.id } });
  const profile: AgentProfile = stored ?? {
    id: '',
    userId: user.id,
    displayName: 'Mirai',
    tone: 'neutral',
    verbosity: 'balanced',
    customInstructions: '',
    updatedAt: new Date(),
  };

  // Before `openStream`, for the reason the stored route gives at length.
  const model = await resolveModel(body.model);

  openStream(res);
  /*
   * No 'user' and no 'assistant' frame: both exist only to hand the client the row
   * ids the server just created, and there are none. The client keeps the ids it
   * made itself.
   */

  const clientGone = new AbortController();
  res.on('close', () => clientGone.abort());

  const searchAllowed = body.search && webSearchEnabled;

  let result;
  try {
    result = await runTurn({
      model,
      messages: [
        { role: 'system', content: systemPrompt(profile, searchAllowed) },
        ...toChatMessages(
          body.history.map((turn) => ({
            role: turn.role,
            content: turn.text,
            attachments: turn.attachments,
          })),
        ),
        { role: 'user', content: toContentParts(body.text, body.attachments) },
      ],
      searchAllowed,
      onDelta: (delta) => send(res, { type: 'delta', text: delta }),
      onTool: (event) => send(res, { type: 'tool', ...event }),
      signal: clientGone.signal,
    });
  } catch (error) {
    // Headers are already out, so the error handler cannot turn this into JSON.
    const message =
      error instanceof HttpError ? error.message : 'Something went wrong generating the reply.';
    console.error('[temporary] generation failed', error);
    send(res, { type: 'error', message });
    res.end();
    return;
  }

  /*
   * `done` carries the assembled text but no message: there is no stored row to
   * describe. The client already has every character from the deltas; this frame is
   * what tells it the turn is finished and whether it finished cleanly.
   *
   * Sources ride on the frame for the same reason -- a temporary turn's citations exist
   * only in the client's copy, and go when it does.
   */
  send(res, {
    type: 'done',
    text: result.text,
    finishReason: result.finishReason,
    ...(result.searches > 0 ? { sources: result.sources } : {}),
  });
  res.end();
}

temporaryRouter.post('/completions', postTemporaryCompletion);
