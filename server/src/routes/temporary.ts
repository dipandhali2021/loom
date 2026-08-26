import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { streamChatCompletion } from '../ai.ts';
import { currentUser } from '../auth.ts';
import { prisma } from '../db.ts';
import { aiModels, appModelIds } from '../env.ts';
import type { AgentProfile } from '../generated/prisma/client.ts';
import { HttpError, parseBody } from '../http.ts';
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
  /** The app's tier, not a provider model id; env.ts maps it. */
  model: z.enum(appModelIds).default('gpt-5'),
  /** Earlier turns of this temporary chat, oldest first. Nothing is stored, so
   * the client is the only thing holding them. */
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        text: z.string().max(32_000),
      }),
    )
    .max(MAX_HISTORY)
    .default([]),
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

  const model = aiModels[body.model];

  openStream(res);
  /*
   * No 'user' and no 'assistant' frame: both exist only to hand the client the row
   * ids the server just created, and there are none. The client keeps the ids it
   * made itself.
   */

  const clientGone = new AbortController();
  res.on('close', () => clientGone.abort());

  let result;
  try {
    result = await streamChatCompletion({
      model,
      messages: [
        { role: 'system', content: systemPrompt(profile) },
        ...toChatMessages(body.history.map((turn) => ({ role: turn.role, content: turn.text }))),
        { role: 'user', content: body.text },
      ],
      onDelta: (delta) => send(res, { type: 'delta', text: delta }),
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
   */
  send(res, { type: 'done', text: result.text, finishReason: result.finishReason });
  res.end();
}

temporaryRouter.post('/completions', postTemporaryCompletion);
