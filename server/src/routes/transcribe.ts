import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';

import { env } from '../env.ts';
import { HttpError } from '../http.ts';

/**
 * POST /api/v1/transcribe
 *
 * Turns a recording from the composer's mic into text. One multipart file in, one
 * `{ text }` out.
 *
 * A proxy rather than a direct call from the app, for the same reason every other
 * model call goes through here: AI_API_KEY is server-only, and putting it in the
 * client bundle to save a hop would publish it. Mounted behind `requireAuth` and
 * `withUser` (see routes/index.ts), so there is no unauthenticated path to a paid
 * speech endpoint, and capped below so one request cannot post an hour of audio.
 *
 * Nothing is stored. The clip lives in memory for the length of the request.
 */

export const transcribeRouter = Router();

/**
 * Ceiling on one clip.
 *
 * 12MB is minutes of the .m4a the recorder produces -- far more than the sentence or
 * two dictation is for -- and small enough that it cannot be used to push a large
 * upload through an authenticated endpoint.
 */
const MAX_AUDIO_BYTES = 12_000_000;

/** The transcription model. Named here rather than in the app: the app cannot be trusted with it. */
const MODEL = 'groq/whisper-large-v3';

/** What the recorder and the pickers actually produce, plus the obvious neighbours. */
const ALLOWED_MIME = /^audio\/(m4a|mp4|x-m4a|aac|mpeg|mp3|wav|x-wav|webm|ogg)$/i;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fields: 2, fileSize: MAX_AUDIO_BYTES },
});

/** How long to wait on the upstream. A clip is transcribed in seconds; this is the ceiling. */
const TIMEOUT_MS = 60_000;

transcribeRouter.post('/', (req, res, next) => {
  upload.single('file')(req, res, (error: unknown) => {
    if (error) {
      if (error instanceof multer.MulterError) {
        next(
          new HttpError(
            413,
            error.code === 'LIMIT_FILE_SIZE'
              ? 'That recording is too long.'
              : 'Send one recording at a time.',
            'audio_too_large',
          ),
        );
        return;
      }
      next(error);
      return;
    }
    void handle(req, res, next);
  });
});

async function handle(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const file = req.file;
    if (!file) throw new HttpError(400, 'No recording was sent.', 'no_audio');

    /*
     * The part's own type first, then the `mimeType` field: a recording arrives as a
     * cache file whose extension the platform does not always map, and the recorder
     * always knows what it wrote.
     */
    const declared = typeof req.body?.mimeType === 'string' ? req.body.mimeType.trim() : '';
    const part = file.mimetype?.trim() || '';
    const mimeType = part && part !== 'application/octet-stream' ? part : declared || 'audio/m4a';
    if (!ALLOWED_MIME.test(mimeType)) {
      throw new HttpError(415, 'That audio format cannot be transcribed.', 'unsupported_audio');
    }

    const clientGone = new AbortController();
    res.on('close', () => clientGone.abort());

    const form = new FormData();
    /*
     * A Blob over the buffer, not a stream: the endpoint needs a length, and a
     * multipart body assembled by hand is a second implementation of something the
     * runtime already has.
     */
    form.append('file', new Blob([new Uint8Array(file.buffer)], { type: mimeType }), 'clip.m4a');
    form.append('model', MODEL);
    form.append('response_format', 'json');

    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    const response = await fetch(`${env.AI_BASE_URL}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.AI_API_KEY}` },
      body: form,
      signal: AbortSignal.any([timeout, clientGone.signal]),
    });

    if (!response.ok) {
      /*
       * Logged, never forwarded: an upstream error body can name the deployment and
       * carry fragments of the credential that was rejected. Same policy as ai.ts.
       */
      const detail = await response.text().catch(() => '');
      console.error(`[transcribe] upstream ${response.status}`, detail.slice(0, 500));
      throw new HttpError(
        502,
        response.status === 401 || response.status === 403
          ? 'The AI provider rejected this server’s credentials.'
          : 'Dictation is unavailable right now. Try again in a moment.',
        'transcribe_failed',
      );
    }

    const body = (await response.json().catch(() => null)) as { text?: unknown } | null;
    const text = typeof body?.text === 'string' ? body.text.trim() : '';

    /*
     * The transcript is untrusted text: it is whatever was said near the microphone,
     * and it lands in the user's own draft where they can read it before sending. It
     * is passed through as a string and never interpreted here.
     */
    if (clientGone.signal.aborted) return;
    res.json({ text });
  } catch (error) {
    if (error instanceof HttpError) {
      next(error);
      return;
    }
    if (res.writableEnded) return;
    console.error('[transcribe] request failed', error);
    next(
      new HttpError(
        502,
        'Dictation is unavailable right now. Try again in a moment.',
        'transcribe_failed',
      ),
    );
  }
}
