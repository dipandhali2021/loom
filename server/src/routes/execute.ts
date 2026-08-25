import { Router } from 'express';
import { z } from 'zod';

import { currentUser } from '../auth.ts';
import { env, sandboxEnabled } from '../env.ts';
import { HttpError, parseBody } from '../http.ts';
import { supportedLanguages } from '../sandbox/languages.ts';
import { RunRejected, runCode } from '../sandbox/run.ts';

/**
 * POST /api/v1/execute
 *
 * Runs one fenced code block in a throwaway microVM and returns what it printed.
 *
 * One JSON response rather than SSE, unlike the completions route next door. A
 * reply is streamed because the first token is useful long before the last one; a
 * run is not -- the sandbox buffers stdout to a pipe and hands it over at exit, so
 * streaming would mean reading that pipe incrementally for output the user cannot
 * act on until the process ends anyway. A run is also capped at
 * SANDBOX_TIMEOUT_MS, which is short enough that a single body is a fair wait.
 *
 * Mounted behind `requireAuth` and `withUser` (see routes/index.ts), so there is no
 * unauthenticated path to an execution engine, and `userId` below is a resolved row
 * id rather than anything the client sent.
 */

export const executeRouter = Router();

const ExecuteBody = z.object({
  /*
   * 100k is far more than a chat reply's code fence and far less than the 1MB
   * express.json limit in app.ts, so an oversized body fails here with a message
   * about the code rather than there with one about the request.
   */
  code: z.string().min(1).max(100_000),
  /** A fence label -- `py`, `cpp`, `ts`. Resolved by sandbox/languages.ts. */
  lang: z.string().trim().min(1).max(32),
});

executeRouter.post('/', async (req, res) => {
  if (!sandboxEnabled) {
    throw new HttpError(
      503,
      'Code execution is not configured on this server.',
      'sandbox_unavailable',
    );
  }

  const user = currentUser(req);
  const body = parseBody(ExecuteBody, req.body);

  /*
   * The client hanging up -- the app backgrounded, the message scrolled away, the
   * user pressing Stop -- aborts the run, so a sandbox is not held open for output
   * nobody is waiting for. Slots are scarce enough that this matters.
   */
  const clientGone = new AbortController();
  res.on('close', () => clientGone.abort());

  try {
    const outcome = await runCode({
      code: body.code,
      lang: body.lang,
      userId: user.id,
      signal: clientGone.signal,
    });

    /*
     * `stdout` and `stderr` are whatever the program printed: untrusted data, passed
     * through as strings and never parsed, evaluated or interpolated into anything.
     * The client renders them as text for the same reason.
     */
    res.json(outcome);
  } catch (error) {
    if (clientGone.signal.aborted) {
      // Nobody is listening; the socket is already gone.
      return;
    }
    if (error instanceof RunRejected) {
      throw new HttpError(400, error.message, 'cannot_run', [
        { path: 'lang', message: `Supported: ${supportedLanguages.join(', ')}` },
      ]);
    }
    /*
     * Anything else is the platform: an expired token, the organization's sandbox
     * limit, a region with no capacity. The message is not forwarded -- it can carry
     * account detail -- but it is logged in full.
     */
    console.error('[execute] sandbox run failed', error);
    throw new HttpError(
      502,
      'The code runner is unavailable right now. Try again in a moment.',
      'sandbox_failed',
    );
  }
});

/** Small enough to be worth exposing: the client greys Run out when this says no. */
executeRouter.get('/status', (_req, res) => {
  res.json({
    available: sandboxEnabled,
    languages: supportedLanguages,
    timeoutMs: env.SANDBOX_TIMEOUT_MS,
    persistent: env.SANDBOX_PERSIST,
  });
});
