import {
  streamChatCompletion,
  type ChatMessage,
  type StreamResult,
  type ToolSpec,
} from './ai.ts';
import { searchWeb, type Source } from './search.ts';

/**
 * One turn, with the web-search tool available.
 *
 * The model is asked; if it comes back wanting a search, the search runs, its result
 * is appended as a `tool` turn, and the model is asked again. Text deltas from every
 * pass go to the same `onDelta`, so the client sees one continuous reply -- a search
 * in the middle of a turn is an interruption in what the server does, not in what the
 * user reads.
 *
 * Bounded at MAX_PASSES rather than looping until the model stops asking. A model that
 * keeps searching is the failure mode that costs real money, and a cap is the only
 * thing that makes the worst case of a turn arithmetic rather than a hope: three
 * passes, at most two searches, so at most 2 x ($0.007 + 3 x $0.001) = $0.02 of
 * retrieval on top of the tokens.
 */

/** How many times the model may be asked in one turn. Two of them may search. */
const MAX_PASSES = 3;

/** Names the model calls. Kept here because the loop dispatches on them. */
const WEB_SEARCH = 'web_search';

const WEB_SEARCH_TOOL: ToolSpec = {
  type: 'function',
  function: {
    name: WEB_SEARCH,
    description:
      'Search the web and read the top results. Use this for anything that happened'
      + ' recently, anything that changes (prices, versions, schedules, standings, who'
      + ' currently holds a role), and anything you would otherwise answer with a'
      + ' caveat about your training data. Cite what you use.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'What to search for, as a search engine query rather than a question.',
        },
        recent: {
          type: 'boolean',
          description:
            'True to search news from the last days rather than the general index.'
            + ' Use for breaking events; leave false for reference material.',
        },
      },
      required: ['query'],
    },
  },
};

/** What the caller is told as the turn progresses, so the UI can say what is happening. */
export type ToolEvent =
  | { phase: 'searching'; query: string }
  | { phase: 'reading'; query: string; sources: Source[] };

export type TurnResult = StreamResult & {
  /** Every source consulted this turn, in the order they were found. */
  sources: Source[];
  /** How many searches actually ran. Zero when the model answered from memory. */
  searches: number;
};

/**
 * Joins the text of two passes.
 *
 * A pass that ends in a tool call can still have emitted prose first -- "Let me look
 * that up" -- and the client has already received those deltas, so the stored copy has
 * to contain them or a reload would show a shorter reply than the user watched arrive.
 * A blank line between them, because they are separated by a search in the same way
 * two paragraphs are.
 */
function join(before: string, after: string): string {
  if (!before.trim()) return after;
  if (!after.trim()) return before;
  return `${before.trimEnd()}\n\n${after}`;
}

/** Sums a token count across passes, keeping null when neither pass reported one. */
function add(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return a + b;
}

/** The arguments a `web_search` call arrives with, once parsed. */
function parseQuery(raw: string): { query: string; recent: boolean } | null {
  try {
    const parsed = JSON.parse(raw) as { query?: unknown; recent?: unknown };
    const query = typeof parsed.query === 'string' ? parsed.query.trim() : '';
    if (!query) return null;
    return { query: query.slice(0, 400), recent: parsed.recent === true };
  } catch {
    // A model that emitted invalid JSON gets told so, which it can recover from.
    return null;
  }
}

export async function runTurn({
  model,
  messages,
  searchAllowed,
  onDelta,
  onTool,
  signal,
}: {
  model: string;
  /** The conversation so far. Copied, not mutated -- the caller keeps its own array. */
  messages: ChatMessage[];
  /** Whether to offer the tool at all. False means one plain pass, as before. */
  searchAllowed: boolean;
  onDelta: (delta: string) => void;
  /** Progress, for the client's waiting state. Never called when nothing is searched. */
  onTool?: (event: ToolEvent) => void;
  signal?: AbortSignal;
}): Promise<TurnResult> {
  const thread: ChatMessage[] = [...messages];
  const sources: Source[] = [];
  const seen = new Set<string>();
  let searches = 0;

  /*
   * Accumulated across passes rather than read off the last one. Every pass streams to
   * the same `onDelta`, so from the client's side this is one reply; the totals here are
   * what make the stored row and the usage figures agree with it.
   */
  let text = '';
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;

  let result = await streamChatCompletion({
    model,
    messages: thread,
    tools: searchAllowed ? [WEB_SEARCH_TOOL] : undefined,
    onDelta,
    signal,
  });
  text = result.text;
  inputTokens = result.inputTokens;
  outputTokens = result.outputTokens;

  for (let pass = 1; pass < MAX_PASSES; pass += 1) {
    if (result.finishReason !== 'tool_calls' || result.toolCalls.length === 0) break;
    if (signal?.aborted) break;

    /*
     * The assistant turn goes back exactly as it came, tool calls and all. Dropping
     * it and sending only the results would leave the model reading answers to
     * questions it has no record of asking, which is what makes a second pass
     * hallucinate a third.
     */
    thread.push({
      role: 'assistant',
      content: result.text.length > 0 ? result.text : null,
      tool_calls: result.toolCalls,
    });

    /*
     * Sequential, not Promise.all. Parallel calls do arrive -- the endpoint indexes
     * them -- but each one is a paid search, and running them together is how a
     * single turn spends four of them before anything can stop it. Two per turn is
     * the ceiling MAX_PASSES sets, and this keeps it true per pass as well.
     */
    for (const call of result.toolCalls) {
      if (call.function.name !== WEB_SEARCH) {
        thread.push({
          role: 'tool',
          tool_call_id: call.id,
          content: `Unknown tool: ${call.function.name}`,
        });
        continue;
      }

      const args = parseQuery(call.function.arguments);
      if (!args) {
        thread.push({
          role: 'tool',
          tool_call_id: call.id,
          content: 'Could not read the arguments. Send valid JSON with a "query" string.',
        });
        continue;
      }

      onTool?.({ phase: 'searching', query: args.query });
      const outcome = await searchWeb({ query: args.query, recent: args.recent, signal });
      searches += 1;

      for (const source of outcome.sources) {
        if (seen.has(source.url)) continue;
        seen.add(source.url);
        sources.push(source);
      }

      if (outcome.sources.length > 0) onTool?.({ phase: 'reading', query: args.query, sources: outcome.sources });

      thread.push({
        role: 'tool',
        tool_call_id: call.id,
        /*
         * A search that found nothing still answers the call. Leaving the call
         * unanswered is a protocol error upstream, and saying so plainly is what
         * stops the model from inventing results in the next pass.
         */
        content:
          outcome.digest
          || `No results for "${args.query}". Say so, or answer from what you already know.`,
      });
    }

    /*
     * The last pass answers without the tool: offering it again to a model that has
     * just used its budget invites another call this loop would have to refuse, which
     * ends the turn with a tool request and no text. Withholding it makes the final
     * pass produce prose by construction.
     */
    const lastPass = pass === MAX_PASSES - 1;
    result = await streamChatCompletion({
      model,
      messages: thread,
      tools: lastPass ? undefined : [WEB_SEARCH_TOOL],
      onDelta,
      signal,
    });
    text = join(text, result.text);
    /*
     * Summed, not replaced. Each pass re-sends the whole thread, so the input counts
     * overlap heavily -- but they are what the provider actually billed, and a figure
     * that under-reports a searched turn as costing one pass is the more misleading of
     * the two.
     */
    inputTokens = add(inputTokens, result.inputTokens);
    outputTokens = add(outputTokens, result.outputTokens);
  }

  /*
   * `finishReason` is the last pass's, since that is the one that decided how the reply
   * ended. A turn that runs out of passes still holding a tool call reports
   * 'tool_calls', which the route stores as `incomplete` -- correctly: the model was
   * cut off mid-plan rather than having finished.
   */
  return { ...result, text, inputTokens, outputTokens, sources, searches };
}
