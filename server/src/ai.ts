import { env } from './env.ts';
import { HttpError } from './http.ts';

/**
 * Thin client for an OpenAI-compatible `/chat/completions` endpoint.
 *
 * Deliberately not the `openai` SDK: the only call this server makes is one
 * streaming POST, and `fetch` plus a small SSE reader is less code than the
 * config surface a client library brings with it.
 */

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

/** One call the model asked for, as it goes back into the conversation. */
export type ToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

/**
 * A turn in the conversation sent upstream.
 *
 * `content` is nullable because an assistant turn that only asked for a tool has no
 * text, and the endpoint expects the field present and null rather than absent.
 * `tool_calls` and `tool_call_id` are snake_case because these objects are serialised
 * straight into the request body -- renaming them here would mean mapping them back.
 */
export type ChatMessage = {
  role: ChatRole;
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
};

/** A function the model may call, in the OpenAI tools shape. */
export type ToolSpec = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

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

type DeltaToolCall = {
  index?: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
};

type StreamChunk = {
  choices?: {
    delta?: { content?: string | null; tool_calls?: DeltaToolCall[] };
    finish_reason?: string | null;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
};

export type StreamResult = {
  text: string;
  finishReason: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  /** Calls the model asked for. Empty unless `finishReason` is 'tool_calls'. */
  toolCalls: ToolCall[];
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
  tools,
  onDelta,
  signal,
}: {
  model: string;
  messages: ChatMessage[];
  /** Functions the model may call this pass. Omitted entirely when there are none. */
  tools?: ToolSpec[];
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
      /*
       * `tools` is spread in rather than sent as undefined: an endpoint that does not
       * support them can reject the key even when it is null, and a turn with nothing
       * to call has no reason to mention them.
       */
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        ...(tools && tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
      }),
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
    /*
     * Keyed by the `index` the frame carries, not pushed in arrival order: parallel
     * calls arrive as separate frames distinguished only by that index, and two calls
     * appended blindly would merge into one if either ever fragments. On this
     * deployment `arguments` does arrive whole in a single frame -- checked -- but the
     * protocol allows it to be split, so the string is appended rather than assigned.
     */
    const calls = new Map<number, { id: string; name: string; args: string }>();

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
      for (const part of choice?.delta?.tool_calls ?? []) {
        const index = part.index ?? 0;
        const existing = calls.get(index) ?? { id: '', name: '', args: '' };
        calls.set(index, {
          id: part.id ?? existing.id,
          name: part.function?.name ?? existing.name,
          args: existing.args + (part.function?.arguments ?? ''),
        });
      }

      if (choice?.finish_reason) finishReason = choice.finish_reason;
      // Usage arrives on the final frame, alongside finish_reason.
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens ?? inputTokens;
        outputTokens = chunk.usage.completion_tokens ?? outputTokens;
      }
    }

    const toolCalls: ToolCall[] = [...calls.entries()]
      .sort(([a], [b]) => a - b)
      .filter(([, call]) => call.id && call.name)
      .map(([, call]) => ({
        id: call.id,
        type: 'function' as const,
        function: { name: call.name, arguments: call.args },
      }));

    return { text, finishReason, inputTokens, outputTokens, toolCalls };
  } catch (error) {
    if (timedOut) throw new AiError('The AI provider timed out.', 504);
    // The client hung up: not an error, just an empty result to persist.
    if (signal?.aborted)
      return {
        text: '',
        finishReason: 'aborted',
        inputTokens: null,
        outputTokens: null,
        toolCalls: [],
      };
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
