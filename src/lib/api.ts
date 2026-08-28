import { fetch } from 'expo/fetch';

/**
 * Client for the Express API in server/.
 *
 * `expo/fetch` rather than the global: it is the WinterCG implementation, and it
 * is the only one on native that gives a real `ReadableStream` body. React
 * Native's built-in fetch buffers the whole response, which would turn a
 * streamed reply into one late block of text.
 */

const BASE_URL = process.env.EXPO_PUBLIC_API_URL;

/** Supplied by the caller so this module never imports Clerk. */
export type GetToken = () => Promise<string | null>;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** Thrown when the caller aborted; callers treat this as "stopped", not "failed". */
export class AbortedError extends Error {
  constructor() {
    super('Aborted.');
    this.name = 'AbortedError';
  }
}

type ErrorBody = { error?: { code?: string; message?: string } };

function requireBaseUrl(): string {
  if (!BASE_URL) {
    throw new ApiError(
      0,
      'not_configured',
      'Missing EXPO_PUBLIC_API_URL. Add it to .env and restart with `npx expo start --clear`.',
    );
  }
  return BASE_URL.replace(/\/+$/, '');
}

async function authorize(getToken: GetToken): Promise<Record<string, string>> {
  const token = await getToken();
  if (!token) throw new ApiError(401, 'unauthorized', 'Your session expired. Sign in again.');
  return { Authorization: `Bearer ${token}` };
}

/**
 * Turns a non-2xx response into an ApiError, preferring the server's own message.
 * A body that is not the expected JSON (a proxy's HTML 502, say) falls back to
 * something a person can read.
 */
async function toApiError(response: {
  status: number;
  text: () => Promise<string>;
}): Promise<ApiError> {
  const raw = await response.text().catch(() => '');
  let parsed: ErrorBody | null = null;
  try {
    parsed = JSON.parse(raw) as ErrorBody;
  } catch {
    parsed = null;
  }
  return new ApiError(
    response.status,
    parsed?.error?.code ?? 'http_error',
    parsed?.error?.message ?? `Request failed (${response.status}).`,
  );
}

async function request<T>(
  path: string,
  getToken: GetToken,
  init: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(await authorize(getToken)),
  };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(`${requireBaseUrl()}${path}`, {
    method: init.method ?? 'GET',
    headers,
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    signal: init.signal ?? null,
  });

  if (!response.ok) throw await toApiError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

// --- DTOs, mirroring server/src/dto.ts --------------------------------------

/** One web page a reply cited. Mirrors `SourceDTO` in server/src/dto.ts. */
export type ApiSource = {
  title: string;
  url: string;
  /** Host as the provider displays it, which is what the chip shows. */
  displayUrl: string;
  publishedAt: string | null;
  /** Whether the page body was read, or only its link was found. */
  fetched: boolean;
};

/**
 * One photo or file a turn carried. Mirrors `Attachment` in server/src/attachments.ts.
 *
 * URLs and extracted text, never bytes: the file went straight to the upload
 * pipeline, and this is only what came back out of it. Small enough that a turn
 * still fits the server's 1MB JSON limit.
 */
export type ApiAttachment = {
  id: string;
  kind: 'image' | 'document';
  name: string;
  mimeType: string;
  size: number;
  /** Pipeline URLs the model is shown -- the photo itself, or a page render. */
  images: string[];
  /** Text pulled out of a document, when the pipeline could extract any. */
  text?: string;
};

export type ApiMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  pending?: boolean;
  /** Present only on a reply that searched the web. */
  sources?: ApiSource[];
  /** Present only on a question that carried photos or files. */
  attachments?: ApiAttachment[];
  createdAt: number;
};

export type ApiConversation = {
  id: string;
  title: string;
  messages: ApiMessage[];
  createdAt: number;
  updatedAt: number;
  archived: boolean;
  pinned: boolean;
};

export type ApiConversationSummary = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
  pinned: boolean;
  messageCount: number;
  preview: string | null;
};

export const listConversations = (getToken: GetToken) =>
  request<{ conversations: ApiConversationSummary[] }>('/api/v1/conversations', getToken).then(
    (body) => body.conversations,
  );

export const getConversation = (getToken: GetToken, conversationId: string) =>
  request<{ conversation: ApiConversation }>(
    `/api/v1/conversations/${conversationId}`,
    getToken,
  ).then((body) => body.conversation);

export const createConversation = (getToken: GetToken, title?: string) =>
  request<{ conversation: ApiConversation }>('/api/v1/conversations', getToken, {
    method: 'POST',
    body: { ...(title ? { title } : {}) },
  }).then((body) => body.conversation);

/**
 * Renames a conversation, pins it, or both.
 *
 * Only the named fields are written -- an omitted `title` is left as it stands, which
 * is what lets a pin travel on its own rather than resending a title and racing a
 * rename against it. The server requires at least one field.
 */
export const updateConversation = (
  getToken: GetToken,
  conversationId: string,
  patch: { title?: string | null; pinned?: boolean },
) =>
  request<{ conversation: ApiConversation }>(
    `/api/v1/conversations/${conversationId}`,
    getToken,
    { method: 'PATCH', body: patch },
  ).then((body) => body.conversation);

export const deleteConversation = (getToken: GetToken, conversationId: string) =>
  request<void>(`/api/v1/conversations/${conversationId}`, getToken, { method: 'DELETE' });

// --- Models -----------------------------------------------------------------

/**
 * One model the picker can offer. Mirrors `CatalogModel` in server/src/models.ts.
 *
 * No capabilities: the server reads these from the proxy, and a proxy "combo"
 * reports none -- what it can accept is decided inside the proxy, not here.
 */
export type ApiModel = {
  id: string;
  /** Derived from the id by the server; safe to render as-is. */
  label: string;
};

/**
 * The catalog, plus which entry to start on.
 *
 * `defaultModel` is null only when the catalog is empty -- nothing is configured
 * upstream yet, which the picker says in as many words rather than showing an
 * empty list.
 */
export const listModels = (getToken: GetToken, { refresh = false } = {}) =>
  request<{ models: ApiModel[]; defaultModel: string | null }>(
    // `refresh` skips the server's five-minute cache. Passed when the user opens the
    // picker, which is the one moment they are looking for a model they just enabled.
    refresh ? '/api/v1/models?refresh=1' : '/api/v1/models',
    getToken,
  );

// --- Code execution ---------------------------------------------------------

/** What server/src/routes/execute.ts returns for one run. */
export type RunResult = {
  stdout: string;
  stderr: string;
  /** Negative when a signal ended it; 124 when the sandbox's deadline did. */
  exitCode: number;
  timedOut: boolean;
  /** True when either stream was cut short by the server's output cap. */
  truncated: boolean;
  durationMs: number;
  /** Whether the run had the user's persistent /workspace mounted. */
  persisted: boolean;
};

/**
 * Runs one code block in a sandbox and resolves with what it printed.
 *
 * A non-zero exit is a normal outcome, not a failure: a program with a syntax error
 * ran exactly as asked and its message belongs on screen. Only the request itself
 * failing -- no session, no runner configured, the platform unavailable -- throws.
 */
export const runCode = (
  getToken: GetToken,
  { code, lang, signal }: { code: string; lang: string; signal?: AbortSignal },
) =>
  request<RunResult>('/api/v1/execute', getToken, { method: 'POST', body: { code, lang }, signal });

// --- Streaming completion ---------------------------------------------------

/**
 * Progress while the server is using a tool, so the waiting state can say what is
 * happening instead of guessing.
 *
 * Two phases rather than one: a search and the page reads after it are seconds apart,
 * and "Searching the web" left on screen through both would go stale exactly when the
 * wait is longest.
 */
export type ToolEvent =
  | { type: 'tool'; phase: 'searching'; query: string }
  | { type: 'tool'; phase: 'reading'; query: string; sources: ApiSource[] };

/** The event frames server/src/routes/completions.ts emits. */
export type CompletionEvent =
  | { type: 'user'; message: ApiMessage }
  | { type: 'assistant'; id: string }
  | { type: 'delta'; text: string }
  | ToolEvent
  | { type: 'done'; message: ApiMessage; finishReason: string | null }
  | { type: 'error'; message: string; messageId: string };

/**
 * The event frames server/src/routes/temporary.ts emits.
 *
 * A narrower set than above, and deliberately not the same type: the `user` and
 * `assistant` frames exist only to hand over the ids of rows the server stored, and
 * a temporary turn stores none -- so `done` carries the text alone and there is no
 * `message.id` for a caller to reach for.
 */
export type TemporaryEvent =
  | { type: 'delta'; text: string }
  | ToolEvent
  | { type: 'done'; text: string; finishReason: string | null; sources?: ApiSource[] }
  | { type: 'error'; message: string };

/** One prior turn of a temporary chat, replayed from the client's own copy. */
export type TemporaryTurn = {
  role: 'user' | 'assistant';
  text: string;
  /** Replayed too, so a follow-up about a photo still has the photo. */
  attachments?: ApiAttachment[];
};

/**
 * Yields each `data:` frame of an SSE body, parsed.
 *
 * Shared by both streaming calls below. Generic in the frame type rather than
 * returning `unknown`: the two routes emit different sets, and the caller knowing
 * which is what keeps the switch statements exhaustive.
 */
async function* readEvents<Event>(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<Event> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      /*
       * Frames are separated by a blank line, and a read can land mid-frame, so
       * only complete frames are consumed and the remainder stays buffered.
       */
      let boundary = buffer.search(/\r?\n\r?\n/);
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/, '');

        for (const line of frame.split(/\r?\n/)) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          try {
            yield JSON.parse(payload) as Event;
          } catch {
            // Skip a frame we cannot parse rather than abandoning the stream.
          }
        }
        boundary = buffer.search(/\r?\n\r?\n/);
      }
    }
  } catch (error) {
    if (signal?.aborted) throw new AbortedError();
    throw error;
  } finally {
    // Releases the native connection whether the caller finished or bailed out.
    await reader.cancel().catch(() => {});
  }
}

/** POSTs an event-stream request and hands back its body, or throws. */
async function openEventStream({
  path,
  getToken,
  body,
  signal,
}: {
  path: string;
  getToken: GetToken;
  body: unknown;
  signal?: AbortSignal;
}): Promise<ReadableStream<Uint8Array>> {
  const response = await fetch(`${requireBaseUrl()}${path}`, {
    method: 'POST',
    headers: {
      ...(await authorize(getToken)),
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
    signal: signal ?? null,
  });

  if (!response.ok) throw await toApiError(response);
  if (!response.body) throw new ApiError(502, 'no_body', 'The server sent no response body.');
  return response.body;
}

/**
 * Posts a turn and yields each event as it arrives.
 *
 * A generator rather than a callback bag so the caller drives consumption with a
 * plain `for await`, and abandoning the loop tears the request down.
 */
export async function* streamCompletion({
  getToken,
  conversationId,
  text,
  model,
  attachments,
  search,
  regenerateMessageId,
  signal,
}: {
  getToken: GetToken;
  conversationId: string;
  text: string;
  /**
   * A model id from `listModels`. Null or absent leaves the choice to the server,
   * which is what happens on the very first turn of a fresh install -- the catalog
   * may not have arrived yet, and a turn should not wait on it.
   */
  model?: string | null;
  /** Photos and files for this turn, as `uploadAttachment` returned them. */
  attachments?: ApiAttachment[];
  /** Let the model search the web for this turn. The composer's switch. */
  search?: boolean;
  /** Rewrite this assistant message instead of appending a new turn. */
  regenerateMessageId?: string;
  signal?: AbortSignal;
}): AsyncGenerator<CompletionEvent> {
  const body = await openEventStream({
    path: `/api/v1/conversations/${conversationId}/completions`,
    getToken,
    body: {
      text,
      ...(model ? { model } : {}),
      ...(attachments && attachments.length > 0 ? { attachments } : {}),
      ...(search ? { search: true } : {}),
      ...(regenerateMessageId ? { regenerateMessageId } : {}),
    },
    signal,
  });
  yield* readEvents<CompletionEvent>(body, signal);
}

/**
 * Posts a turn to the temporary route, which stores nothing.
 *
 * `history` is the whole context the reply gets: there is no conversation row for
 * the server to read earlier turns from, so the client's own copy is it. Nothing
 * here carries a conversation id, because a temporary chat never has one -- which
 * is also what makes it impossible for this call to write to the wrong one.
 */
export async function* streamTemporaryCompletion({
  getToken,
  text,
  model,
  history,
  attachments,
  search,
  signal,
}: {
  getToken: GetToken;
  text: string;
  /** A model id from `listModels`; see `streamCompletion`. */
  model?: string | null;
  history: TemporaryTurn[];
  /** Photos and files for this turn, as `uploadAttachment` returned them. */
  attachments?: ApiAttachment[];
  /** Let the model search the web for this turn. The composer's switch. */
  search?: boolean;
  signal?: AbortSignal;
}): AsyncGenerator<TemporaryEvent> {
  const body = await openEventStream({
    path: '/api/v1/temporary/completions',
    getToken,
    body: {
      text,
      ...(model ? { model } : {}),
      history,
      ...(attachments && attachments.length > 0 ? { attachments } : {}),
      ...(search ? { search: true } : {}),
    },
    signal,
  });
  yield* readEvents<TemporaryEvent>(body, signal);
}

// --- Attachments and dictation (multipart) ----------------------------------

/**
 * POSTs one local file to a route that expects `multipart/form-data`.
 *
 * The multipart body is built natively, by `expo-file-system`'s own upload task,
 * rather than handed to `fetch` as a `FormData`. Both routes work in principle, but
 * the `FormData` one loses the part's content type on exactly the files a picker
 * produces: `expo/fetch` only writes a part `Content-Type` when `File.type` is a
 * non-empty string, `File.type` is derived from the path extension and is empty
 * whenever the platform cannot map it, and a part with no content type makes the
 * server's parser fall back to its default of `text/plain`. A PDF then arrives
 * announced as text. The native task takes the mime as an explicit option, so the
 * type the picker reported is the type the server reads back.
 *
 * It also avoids reading the file through the permission-checked JS API. In Expo Go
 * on Android the document picker copies into the base cache directory while the
 * file-system module resolves permissions against the per-experience scoped ones, so
 * a file that is present and readable can report as inaccessible. The native task
 * streams it with the OS's own handle and never consults that check.
 */
async function postFile<T>(
  path: string,
  getToken: GetToken,
  {
    uri,
    name,
    mimeType,
    signal,
  }: { uri: string; name?: string; mimeType?: string; signal?: AbortSignal },
): Promise<T> {
  const { File, UploadType } = await import('expo-file-system');

  let file: InstanceType<typeof File>;
  try {
    file = new File(uri);
  } catch {
    throw new ApiError(0, 'unreadable_file', 'That file could not be read.');
  }

  await describeUpload(path, file, { uri, name, mimeType });
  const startedAt = Date.now();

  /*
   * The display name travels as a form field. The part's own `filename` is whatever
   * the picker called its cache copy ("cropped1814158652.jpg"), and the label the
   * user sees -- and the model is told -- should be the name they recognise.
   */
  const parameters: Record<string, string> = {};
  if (name) parameters.name = name;
  if (mimeType) parameters.mimeType = mimeType;

  let result: { status: number; body: string };
  try {
    result = await file.upload(`${requireBaseUrl()}${path}`, {
      httpMethod: 'POST',
      uploadType: UploadType.MULTIPART,
      fieldName: 'file',
      ...(mimeType ? { mimeType } : {}),
      parameters,
      headers: { Accept: 'application/json', ...(await authorize(getToken)) },
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
      throw new AbortedError();
    }
    if (__DEV__) {
      console.log(
        `[upload] ${path} <- failed after ${Date.now() - startedAt}ms ::`,
        error instanceof Error ? error.message : error,
      );
    }
    throw new ApiError(0, 'unreadable_file', 'That file could not be read.');
  }

  if (result.status < 200 || result.status >= 300) {
    const failure = await toApiError({ status: result.status, text: async () => result.body });
    if (__DEV__) {
      console.log(
        `[upload] ${path} <- ${result.status} ${failure.code} after ${Date.now() - startedAt}ms :: ${failure.message}`,
      );
    }
    throw failure;
  }
  if (__DEV__) console.log(`[upload] ${path} <- 200 after ${Date.now() - startedAt}ms`);

  try {
    return JSON.parse(result.body) as T;
  } catch {
    throw new ApiError(result.status, 'http_error', 'The server sent something unreadable.');
  }
}

/**
 * Logs what is actually about to be uploaded, in development only.
 *
 * Every field the server decides a type from originates here, and each of them can be
 * empty or wrong without anything looking broken: a picker reports no `mimeType`, and
 * the platform cannot always map a cache copy's extension, which leaves `File.type`
 * empty. The first bytes are logged beside them because they are the one source that
 * cannot lie -- a PDF starts `%PDF-`, and if that is missing the file itself is the
 * problem, not the labelling.
 *
 * The labels are logged before the bytes are touched, and separately, because reading
 * through this API is permission-checked and can fail on a file the upload itself
 * will stream happily. When that happens the failure is the interesting part.
 */
async function describeUpload(
  path: string,
  file: { size: number | null; type: string | null; uri: string; bytes: () => Promise<Uint8Array> },
  picked: { uri: string; name?: string; mimeType?: string },
): Promise<void> {
  if (!__DEV__) return;
  console.log(
    [
      `[upload] ${path} ->`,
      `name=${JSON.stringify(picked.name ?? '')}`,
      `picked.mimeType=${JSON.stringify(picked.mimeType ?? '')}`,
      `File.type=${JSON.stringify(file.type)}`,
      `size=${file.size ?? '-'}`,
      `uri=${picked.uri}`,
    ].join(' '),
  );
  try {
    const head = (await file.bytes()).slice(0, 8);
    const hex = Array.from(head, (byte) => byte.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(head, (byte) =>
      byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : '.',
    ).join('');
    console.log(`[upload] ${path} -> head=[${hex}] "${ascii}"`);
  } catch (error) {
    console.log(
      `[upload] ${path} -> could not read bytes in JS (the native upload may still work):`,
      error instanceof Error ? error.message : error,
    );
  }
}

/**
 * Sends one photo or file to the upload pipeline and resolves with what to attach.
 *
 * The bytes go to the pipeline, not into a chat message: what comes back is URLs and
 * any text that could be extracted, which is small enough to ride along in the
 * turn's JSON body. Throws `ApiError` on refusal (too large, wrong kind, pipeline
 * unavailable) with a message meant to be shown.
 */
export const uploadAttachment = (
  getToken: GetToken,
  opts: { uri: string; name?: string; mimeType?: string; signal?: AbortSignal },
) =>
  postFile<{ attachment: ApiAttachment }>('/api/v1/uploads', getToken, opts).then(
    (body) => body.attachment,
  );

/** Whether this server can take attachments at all, and how big. */
export const uploadStatus = (getToken: GetToken) =>
  request<{ available: boolean; maxBytes: number }>('/api/v1/uploads/status', getToken);

/**
 * Transcribes a recorded clip and resolves with its text.
 *
 * The result lands in the user's own draft, where they read it before sending -- it
 * is never fed anywhere on its own.
 */
export const transcribe = (
  getToken: GetToken,
  opts: { uri: string; mimeType?: string; signal?: AbortSignal },
) => postFile<{ text: string }>('/api/v1/transcribe', getToken, opts).then((body) => body.text);
