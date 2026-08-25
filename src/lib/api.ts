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
async function toApiError(response: { status: number; text: () => Promise<string> }): Promise<ApiError> {
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

export type ApiMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  pending?: boolean;
  createdAt: number;
};

export type ApiConversation = {
  id: string;
  title: string;
  messages: ApiMessage[];
  createdAt: number;
  updatedAt: number;
  archived: boolean;
};

export type ApiConversationSummary = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
  messageCount: number;
  preview: string | null;
};

export const listConversations = (getToken: GetToken) =>
  request<{ conversations: ApiConversationSummary[] }>('/api/v1/conversations', getToken).then(
    (body) => body.conversations,
  );

export const getConversation = (getToken: GetToken, conversationId: string) =>
  request<{ conversation: ApiConversation }>(`/api/v1/conversations/${conversationId}`, getToken).then(
    (body) => body.conversation,
  );

export const createConversation = (getToken: GetToken, title?: string) =>
  request<{ conversation: ApiConversation }>('/api/v1/conversations', getToken, {
    method: 'POST',
    body: { ...(title ? { title } : {}) },
  }).then((body) => body.conversation);

export const deleteConversation = (getToken: GetToken, conversationId: string) =>
  request<void>(`/api/v1/conversations/${conversationId}`, getToken, { method: 'DELETE' });

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
) => request<RunResult>('/api/v1/execute', getToken, { method: 'POST', body: { code, lang }, signal });

// --- Streaming completion ---------------------------------------------------

/** The event frames server/src/routes/completions.ts emits. */
export type CompletionEvent =
  | { type: 'user'; message: ApiMessage }
  | { type: 'assistant'; id: string }
  | { type: 'delta'; text: string }
  | { type: 'done'; message: ApiMessage; finishReason: string | null }
  | { type: 'error'; message: string; messageId: string };

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
  regenerateMessageId,
  signal,
}: {
  getToken: GetToken;
  conversationId: string;
  text: string;
  model: string;
  /** Rewrite this assistant message instead of appending a new turn. */
  regenerateMessageId?: string;
  signal?: AbortSignal;
}): AsyncGenerator<CompletionEvent> {
  const response = await fetch(
    `${requireBaseUrl()}/api/v1/conversations/${conversationId}/completions`,
    {
      method: 'POST',
      headers: {
        ...(await authorize(getToken)),
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        text,
        model,
        ...(regenerateMessageId ? { regenerateMessageId } : {}),
      }),
      signal: signal ?? null,
    },
  );

  if (!response.ok) throw await toApiError(response);
  if (!response.body) throw new ApiError(502, 'no_body', 'The server sent no response body.');

  const reader = response.body.getReader();
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
            yield JSON.parse(payload) as CompletionEvent;
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
