import { env } from './env.ts';
import { HttpError } from './http.ts';

/**
 * Thin client for an OpenAI-compatible `/chat/completions` endpoint.
 *
 * Deliberately not the `openai` SDK: the only call this server makes is one
 * streaming POST, and `fetch` plus a small SSE reader is less code than the
 * config surface a client library brings with it.
 */

export type ChatRole = 'system' | 'user' | 'assistant';
export type ChatMessage = { role: ChatRole; content: string };

/** How long to wait for the *first* byte before giving up on the upstream. */
const CONNECT_TIMEOUT_MS = 30_000;
/**
 * How long a stream may stall mid-reply. Reset on every chunk, so a slow but
 * live generation is never cut off -- only a genuinely dead socket is.
 */
const STALL_TIMEOUT_MS = 60_000;

export class AiError extends HttpError {
  constructor(message: string, status = 502) {
    super(status, message, 'ai_unavailable');
    this.name = 'AiError';
  }
}

type StreamChunk = {
  choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
};

export type StreamResult = {
  text: string;
  finishReason: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
};

/**
 * Streams a completion, handing each text delta to `onDelta` as it arrives and
 * resolving with the assembled reply.
 *
 * `signal` is the caller's abort (a disconnected client), which is forwarded
 * upstream so an abandoned request stops being billed.
 */
export async function streamChatCompletion({
  model,
  messages,
  onDelta,
  signal,
}: {
  model: string;
  messages: ChatMessage[];
  onDelta: (delta: string) => void;
  signal?: AbortSignal;
}): Promise<StreamResult> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });

  /*
   * One timer covers both phases: armed before the request for the connect
   * budget, then re-armed on every chunk with the stall budget.
   */
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const arm = (ms: number) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, ms);
  };

  arm(CONNECT_TIMEOUT_MS);

  try {
    const response = await fetch(`${env.AI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.AI_API_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({ model, messages, stream: true }),
      signal: controller.signal,
    });

    if (!response.ok || !response.body) {
      /*
       * Read the body for the log but never forward it: an upstream error can
       * quote the request, and echoing a provider's message to the client is
       * how key fragments and internal hostnames leak.
       */
      const detail = await response.text().catch(() => '');
      console.error(`[ai] upstream ${response.status} for model ${model}`, detail.slice(0, 500));
      if (response.status === 401 || response.status === 403) {
        throw new AiError('The AI provider rejected this server’s credentials.');
      }
      if (response.status === 429) {
        throw new AiError('The AI provider is rate limiting requests. Try again shortly.', 429);
      }
      throw new AiError('The AI provider could not be reached.');
    }

    let text = '';
    let finishReason: string | null = null;
    let inputTokens: number | null = null;
    let outputTokens: number | null = null;

    for await (const data of readSse(response.body, () => arm(STALL_TIMEOUT_MS))) {
      if (data === '[DONE]') break;

      let chunk: StreamChunk;
      try {
        chunk = JSON.parse(data) as StreamChunk;
      } catch {
        // A malformed frame is not worth failing a live reply over.
        continue;
      }

      const choice = chunk.choices?.[0];
      const delta = choice?.delta?.content;
      if (delta) {
        text += delta;
        onDelta(delta);
      }
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      // Usage arrives on the final frame, alongside finish_reason.
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens ?? inputTokens;
        outputTokens = chunk.usage.completion_tokens ?? outputTokens;
      }
    }

    return { text, finishReason, inputTokens, outputTokens };
  } catch (error) {
    if (timedOut) throw new AiError('The AI provider timed out.', 504);
    // The client hung up: not an error, just an empty result to persist.
    if (signal?.aborted) return { text: '', finishReason: 'aborted', inputTokens: null, outputTokens: null };
    if (error instanceof HttpError) throw error;
    console.error('[ai] request failed', error);
    throw new AiError('The AI provider could not be reached.');
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

/**
 * Yields the payload of each `data:` line in an SSE stream.
 *
 * Chunk boundaries are arbitrary, so a frame can straddle two reads -- hence the
 * buffer, and why splitting on a blank line rather than on every newline matters.
 */
async function* readSse(
  body: ReadableStream<Uint8Array>,
  onChunk: () => void,
): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = '';

  for await (const bytes of body as unknown as AsyncIterable<Uint8Array>) {
    onChunk();
    buffer += decoder.decode(bytes, { stream: true });

    let boundary = buffer.search(/\r?\n\r?\n/);
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/, '');

      for (const line of frame.split(/\r?\n/)) {
        if (line.startsWith('data:')) yield line.slice(5).trim();
      }
      boundary = buffer.search(/\r?\n\r?\n/);
    }
  }

  // A final frame with no trailing blank line still counts.
  for (const line of buffer.split(/\r?\n/)) {
    if (line.startsWith('data:')) yield line.slice(5).trim();
  }
}
