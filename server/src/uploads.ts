import { Readable } from 'node:stream';

import {
  ApiError,
  Transloadit,
  type AssemblyStatus,
  type CreateAssemblyParams,
} from '@transloadit/node';

import type { Attachment } from './attachments.ts';
import { MAX_ATTACHMENT_TEXT } from './attachments.ts';
import { env, uploadsEnabled } from './env.ts';
import { HttpError } from './http.ts';

/**
 * Attachment processing, via a saved Transloadit Template.
 *
 * Why an upload pipeline at all, rather than posting the file to the model as a data
 * URI: a photo off a phone camera is several megabytes, base64 adds a third to that,
 * and app.ts caps a JSON body at 1MB. The pipeline also does the part this server
 * has no business doing -- re-encoding an image, rendering a page of a document --
 * and hands back URLs the AI endpoint fetches directly.
 *
 * Credentials come from env.ts. The Auth Secret only ever signs a request inside this
 * module: it is never logged, never returned, and never reaches the app.
 */

/** Step names in the saved Template, so results can be read back by name. */
const IMAGE_STEP = 'images_webp_optimized';
const DOCUMENT_STEP = 'documents_pdf_preview';
/** Steps this server adds on top of the Template, per input kind. */
const TEXT_STEP = 'attachment_text';

/**
 * How many pages of a document are rendered.
 *
 * Each page is an image on the turn, and images are the expensive part of a request,
 * so this is deliberately a handful rather than "the document". Four pages is enough
 * for the letters, invoices and short reports people actually attach to a chat.
 */
const MAX_PAGES = 4;

/**
 * A content type reduced to just the type.
 *
 * A mime reaches this server from a picker, a platform's own guess and a multipart
 * header, and any of the three may add a parameter or a capital:
 * `application/pdf; charset=binary` is the same file as `application/pdf`, but an
 * exact comparison says otherwise -- and getting that comparison wrong sends a PDF to
 * the converter below that refuses it. Normalised once, at the top of the pipeline, so
 * every check here and in the route reads a bare lowercase type.
 */
export const normalizeMimeType = (mimeType: string) =>
  mimeType.split(';')[0]?.trim().toLowerCase() ?? '';

/** ISO base media brands, by the format each one means. */
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'heim', 'heis', 'hevm', 'hevs']);
const HEIF_BRANDS = new Set(['mif1', 'msf1']);
const AVIF_BRANDS = new Set(['avif', 'avis']);

/**
 * The type a file's own first bytes say it is.
 *
 * The last resort when both the part header and the client's field say octet-stream,
 * which is what a share-sheet copy or an extensionless cache file arrives as. Refusing
 * those would refuse ordinary PDFs and photos, and guessing from the filename trusts a
 * string the client chose; the magic number is the file itself. Only the formats the
 * route's allowlist already accepts are recognised -- this widens what can be
 * identified, never what can be attached.
 */
export function sniffMimeType(buffer: Buffer): string | null {
  const startsWith = (...bytes: number[]) =>
    buffer.length >= bytes.length && bytes.every((byte, index) => buffer[index] === byte);
  const ascii = (start: number, end: number) => buffer.subarray(start, end).toString('latin1');

  if (startsWith(0x25, 0x50, 0x44, 0x46, 0x2d)) return 'application/pdf'; // %PDF-
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (startsWith(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (buffer.length >= 6 && /^GIF8[79]a$/.test(ascii(0, 6))) return 'image/gif';
  if (buffer.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') {
    return 'image/webp';
  }

  // ISO base media: 'ftyp' at byte 4, then a brand naming the flavour.
  if (buffer.length >= 12 && ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12).toLowerCase();
    if (HEIC_BRANDS.has(brand)) return 'image/heic';
    if (HEIF_BRANDS.has(brand)) return 'image/heif';
    if (AVIF_BRANDS.has(brand)) return 'image/avif';
  }

  return null;
}

/**
 * Formats the Template's document branch refuses.
 *
 * The Template's converter rejects a PDF as *input* -- it is the output format of that
 * branch, not an input it accepts -- so a PDF has to be routed to page rendering
 * instead. Checked by mime rather than by trying and recovering, because a failed
 * Assembly still spends upload minutes.
 *
 * Both take a `normalizeMimeType` result, not a raw header.
 */
const isPdf = (mimeType: string) => mimeType === 'application/pdf';
const isImage = (mimeType: string) => mimeType.startsWith('image/');

/** One `results` entry, narrowed to the fields this module reads. */
type StepResult = { ssl_url?: string; url?: string; mime?: string; size?: number };

function stepResults(status: AssemblyStatus, step: string): StepResult[] {
  const results = (status.results ?? {}) as Record<string, StepResult[] | undefined>;
  return results[step] ?? [];
}

/** The https URL for a result. `ssl_url` always exists in practice; `url` is the fallback. */
const urlOf = (result: StepResult): string | null => result.ssl_url ?? result.url ?? null;

/**
 * The URL of a result, if the result is actually a picture.
 *
 * The Template's document branch renders a PDF preview, and a PDF is a perfectly good
 * result that is not an image. Put in `images` it becomes an `image_url` part, and the
 * provider fetches it, fails to type it as a picture, and rejects the whole turn with
 * "Unsupported MIME type: image/*" -- so one attached .docx made every reply on that
 * conversation fail, including later ones, because history replays attachments. The
 * step's own reported mime decides, rather than the branch it came from.
 */
const imageUrlOf = (result: StepResult): string | null =>
  normalizeMimeType(result.mime ?? '').startsWith('image/') ? urlOf(result) : null;

export class UploadError extends HttpError {
  constructor(message: string, status = 502) {
    super(status, message, 'upload_failed');
    this.name = 'UploadError';
  }
}

let client: Transloadit | null = null;

/**
 * The SDK client, built once.
 *
 * Lazily rather than at module load so importing this file cannot throw: the route
 * checks `uploadsEnabled` and answers 503, which is a clearer failure than a server
 * that will not start because a feature nobody configured has no credentials.
 */
function transloadit(): Transloadit {
  if (!uploadsEnabled || !env.TRANSLOADIT_KEY || !env.TRANSLOADIT_SECRET) {
    throw new HttpError(
      503,
      'Attachments are not configured on this server.',
      'uploads_unavailable',
    );
  }
  client ??= new Transloadit({
    authKey: env.TRANSLOADIT_KEY,
    authSecret: env.TRANSLOADIT_SECRET,
  });
  return client;
}

/**
 * The steps to run for one file, on top of the saved Template.
 *
 * Three shapes, because the Template's own two branches do not cover every input:
 *
 *   image     -- the Template as saved: a webp optimised for viewing.
 *   PDF       -- the document branch redirected to page rendering, since the converter
 *                will not take a PDF as input at all.
 *   other doc -- the Template plus a text extraction, because text is what a model
 *                reads best: a .docx as a page image is OCR of something we already
 *                have the characters for.
 */
function stepsFor(mimeType: string): CreateAssemblyParams['steps'] {
  if (isImage(mimeType)) return undefined;

  if (isPdf(mimeType)) {
    return {
      [DOCUMENT_STEP]: {
        robot: '/document/thumbs',
        use: ':original',
        format: 'png',
        width: 1400,
        pages: Array.from({ length: MAX_PAGES }, (_, index) => index + 1),
      },
    };
  }

  return {
    [TEXT_STEP]: { robot: '/document/convert', use: ':original', format: 'txt' },
  };
}

/**
 * Fetches the extracted text of a document.
 *
 * Read here rather than handed to the client as a URL: the text goes into the prompt,
 * so the server needs it in hand anyway, and a URL the client fetched and posted back
 * would be a way to put arbitrary text in the prompt. Truncated to the same ceiling
 * the schema enforces, and a failure is not fatal -- an attachment with page images
 * and no text is still useful.
 */
async function fetchText(url: string): Promise<string | undefined> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return undefined;
    const text = await response.text();
    const trimmed = text.trim();
    if (!trimmed) return undefined;
    return trimmed.length > MAX_ATTACHMENT_TEXT
      ? `${trimmed.slice(0, MAX_ATTACHMENT_TEXT - 1)}…`
      : trimmed;
  } catch {
    // The result URL is public and short-lived; a miss here is not worth failing over.
    return undefined;
  }
}

/**
 * Runs one file through the Template and returns what the model can use.
 *
 * `waitForCompletion` rather than returning an Assembly id to poll: an image takes
 * about four seconds end to end, which is inside one request, and a two-phase flow
 * would mean the app holding an attachment that is not yet usable at the moment the
 * user hits send. The Assembly id comes back regardless, so a failure is traceable.
 */
export async function processUpload({
  buffer,
  filename,
  mimeType,
  signal,
}: {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  signal?: AbortSignal;
}): Promise<Attachment> {
  const client = transloadit();
  const type = normalizeMimeType(mimeType) || 'application/octet-stream';
  const steps = stepsFor(type);
  const branch = isImage(type) ? 'template only' : isPdf(type) ? 'page render' : 'text convert';
  console.log(`[uploads] ${filename} ${type} ${buffer.byteLength}B -> ${branch}`);
  const startedAt = Date.now();

  let status: AssemblyStatus;
  try {
    status = await client.createAssembly({
      // A stream, not a temp file: the bytes are already in memory from the
      // request, and writing them to disk would be a copy of user data this
      // server has no reason to keep.
      uploads: { file1: Readable.from(buffer) },
      params: {
        template_id: env.TRANSLOADIT_TEMPLATE_ID,
        ...(steps ? { steps } : {}),
      },
      waitForCompletion: true,
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    /*
     * Logged in full -- the raw message names robots, steps and account limits, all
     * of which is what a developer needs -- and deliberately not forwarded: it can
     * carry account detail, and it is written for someone who can read the Template.
     */
    if (error instanceof ApiError) {
      console.error(
        `[uploads] assembly failed after ${Date.now() - startedAt}ms code=${error.code} assembly=${error.assemblyId ?? '-'} type=${type} branch=${branch}`,
        error.rawMessage ?? error.message,
      );
    } else {
      console.error(`[uploads] assembly failed type=${type} branch=${branch}`, error);
    }
    throw new UploadError('That file could not be processed. Try a different one.');
  }

  /*
   * A rejected step does not throw: the SDK resolves with `error` set and `results`
   * empty, so the failure has to be read off the status rather than caught.
   */
  if (status.error || status.ok !== 'ASSEMBLY_COMPLETED') {
    console.error(
      `[uploads] assembly ${status.assembly_id ?? '-'} did not complete after ${Date.now() - startedAt}ms type=${type} branch=${branch}`,
      status.error ?? status.ok,
      status.message ?? '',
    );
    throw new UploadError('That file could not be processed. Try a different one.');
  }

  const assemblyId = status.assembly_id ?? '';
  const kind: Attachment['kind'] = isImage(type) ? 'image' : 'document';
  console.log(
    `[uploads] assembly ${assemblyId} completed in ${Date.now() - startedAt}ms, steps=${Object.keys(status.results ?? {}).join(',') || '-'}`,
  );

  const images = (
    kind === 'image' ? stepResults(status, IMAGE_STEP) : stepResults(status, DOCUMENT_STEP)
  )
    .map(imageUrlOf)
    .filter((url): url is string => url !== null)
    .slice(0, MAX_PAGES);

  const textResult = stepResults(status, TEXT_STEP)[0];
  const textUrl = textResult ? urlOf(textResult) : null;
  const text = textUrl ? await fetchText(textUrl) : undefined;

  if (images.length === 0 && !text) {
    console.error(`[uploads] assembly ${assemblyId} produced nothing usable for ${type}`);
    throw new UploadError('Nothing could be read out of that file.', 422);
  }

  return {
    id: assemblyId,
    kind,
    name: filename,
    mimeType: type,
    size: buffer.byteLength,
    images,
    ...(text ? { text } : {}),
  };
}
