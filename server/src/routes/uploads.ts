import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';

import { env, uploadsEnabled } from '../env.ts';
import { HttpError } from '../http.ts';
import { normalizeMimeType, processUpload, sniffMimeType } from '../uploads.ts';

/**
 * POST /api/v1/uploads
 *
 * Takes one file from the composer's Photos or Files row, runs it through the upload
 * pipeline, and returns the URLs and extracted text a turn can carry (see
 * attachments.ts for that shape).
 *
 * Mounted behind `requireAuth` and `withUser` (see routes/index.ts), so there is no
 * unauthenticated path to a pipeline that costs money per file. The caps below are
 * the second half of that: one file per request, and no more than UPLOAD_MAX_BYTES of
 * it, enforced by multer before a byte is forwarded anywhere.
 *
 * Nothing is stored on this server. The bytes live in memory for the length of one
 * request and are handed straight to the pipeline as a stream.
 */

export const uploadsRouter = Router();

/**
 * Accepted types.
 *
 * An allowlist rather than a size check alone: the pipeline has a branch for images
 * and a branch for documents, and anything else -- an archive, a binary, a video --
 * would spend upload minutes to fail a step. Refused here instead, by the type the
 * file resolves to below.
 *
 * Matched against a normalised type, so the patterns can be exact: a parameter or a
 * capital is gone before it reaches them.
 */
const ALLOWED_MIME = [
  /^image\/(jpeg|png|webp|gif|heic|heif|avif)$/i,
  /^application\/pdf$/i,
  /^text\/(plain|markdown|csv)$/i,
  /^application\/(msword|rtf|json)$/i,
  /^application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation)$/i,
  /^application\/vnd\.oasis\.opendocument\.(text|spreadsheet|presentation)$/i,
  /^application\/vnd\.ms-(excel|powerpoint)$/i,
];

const isAllowed = (mimeType: string) => ALLOWED_MIME.some((pattern) => pattern.test(mimeType));

/*
 * Memory storage, deliberately. A disk destination would leave someone's photo in a
 * temp directory after the response, and the file is only ever passed through: it is
 * read once, streamed onward, and dropped when the request ends.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fields: 4, fileSize: env.UPLOAD_MAX_BYTES },
});

/** A megabyte count for a message, so the ceiling is stated in the units people use. */
const asMegabytes = (bytes: number) => Math.floor(bytes / 1_000_000);

uploadsRouter.post('/', (req, res, next) => {
  if (!uploadsEnabled) {
    next(
      new HttpError(503, 'Attachments are not configured on this server.', 'uploads_unavailable'),
    );
    return;
  }

  upload.single('file')(req, res, (error: unknown) => {
    if (error) {
      /*
       * multer's own failures are the caps above being hit, which is a client
       * problem and safe to describe: the limit is not a secret, and "too large"
       * with no number is a message a user cannot act on.
       */
      if (error instanceof multer.MulterError) {
        const message =
          error.code === 'LIMIT_FILE_SIZE'
            ? `That file is too large. The limit is ${asMegabytes(env.UPLOAD_MAX_BYTES)}MB.`
            : 'Attach one file at a time.';
        next(new HttpError(413, message, 'file_too_large'));
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
    if (!file) {
      throw new HttpError(400, 'No file was attached.', 'no_file');
    }

    /*
     * What kind of file this is, decided by the bytes first and the labels second.
     *
     * All three sources lie in ordinary use. The multipart part header is the worst of
     * them: `File`'s content type is empty whenever the platform cannot map a picker's
     * cache copy, an empty content type does not parse, and an unparseable one makes
     * the parser fall back to its default of `text/plain` -- so a PDF used to arrive
     * announced as text, pass the allowlist, and be sent to the converter that refuses
     * a PDF as input. The `mimeType` field is the client's own conclusion from the
     * picker plus the extension, which is better informed, but still a claim.
     *
     * A magic number is not a claim, so it wins outright where it is recognised. Below
     * that the client's field, then the part header, then nothing. Every candidate is
     * normalised, because the pipeline compares types exactly and any of them may
     * arrive with a `; charset=` parameter or a capital.
     */
    const declared = normalizeMimeType(
      typeof req.body?.mimeType === 'string' ? req.body.mimeType : '',
    );
    const part = normalizeMimeType(file.mimetype ?? '');
    const specific = (value: string) => value && value !== 'application/octet-stream';
    const mimeType =
      sniffMimeType(file.buffer) ?? [declared, part].find(specific) ?? 'application/octet-stream';

    /*
     * One line per upload, naming all three sources and the leading bytes. What made
     * the PDF failure hard to place was that nothing recorded which type the pipeline
     * was given, so a mislabelled file and a broken file looked identical from here.
     */
    console.log(
      `[uploads] part=${JSON.stringify(part)} declared=${JSON.stringify(declared)} sniffed=${JSON.stringify(sniffMimeType(file.buffer))} -> ${mimeType} size=${file.buffer.byteLength} head=${JSON.stringify(file.buffer.subarray(0, 8).toString('latin1'))}`,
    );

    if (!isAllowed(mimeType)) {
      throw new HttpError(415, 'That kind of file cannot be attached.', 'unsupported_file');
    }

    /*
     * The filename comes from the client and is only ever shown back to the user and
     * put in the prompt as a label -- never used as a path, and never opened. Kept to
     * its basename anyway, so a name carrying directory separators cannot read as one.
     *
     * The `name` field wins over the part's filename: the app uploads a picker's cache
     * copy, so the multipart filename is "cropped1814158652.jpg" while the name the
     * user recognises rides alongside it.
     */
    const supplied = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const filename =
      (supplied || file.originalname || 'attachment').split(/[\\/]/).pop() || 'attachment';

    /*
     * The client hanging up cancels the Assembly rather than leaving it running for a
     * result nobody will collect -- the same reason /execute aborts its sandbox.
     */
    const clientGone = new AbortController();
    res.on('close', () => clientGone.abort());

    const attachment = await processUpload({
      buffer: file.buffer,
      filename: filename.slice(0, 255),
      mimeType,
      signal: clientGone.signal,
    });

    if (clientGone.signal.aborted) return;
    res.json({ attachment });
  } catch (error) {
    next(error);
  }
}

/** Mirrors /execute/status: the panel greys the rows out when this says no. */
uploadsRouter.get('/status', (_req, res) => {
  res.json({
    available: uploadsEnabled,
    maxBytes: env.UPLOAD_MAX_BYTES,
  });
});
