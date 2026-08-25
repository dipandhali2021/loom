/**
 * Chunked reveal for a streaming reply.
 *
 * Arrival and display are deliberately decoupled. Deltas do not land at a
 * readable rate: a provider (or the native networking layer) can hand over
 * several hundred characters in one go. Worse, when the response body is already
 * buffered natively, every `reader.read()` resolves as a microtask -- so an
 * interval-based flush never gets a turn and the whole reply lands in one write.
 *
 * The reveal is therefore driven off `requestAnimationFrame`, which is a
 * macrotask and always gets a slot, and it hands over whole *parts* rather than
 * single characters: a phrase or sentence at a time, snapped to a word or
 * sentence boundary, so each part can fade in as one piece. Every emission
 * reports where the new part starts, which is what lets the view animate only
 * that span and leave everything before it alone.
 */

/**
 * Minimum gap between parts -- about five and a half a second, which reads as
 * deliberate. The view's fade is deliberately shorter than this: one part is
 * finished animating before the next arrives, which is what lets the view keep a
 * single animating span instead of several. See PART_FADE_MS in Markdown.tsx.
 */
const PART_INTERVAL_MS = 180;
/** Characters in a part at rest. */
const BASE_PART_CHARS = 34;
/** Share of the backlog folded into the part size, so a burst catches up. */
const CATCH_UP_DIVISOR = 7;
/** How far past the target to look for a sentence end worth landing on. */
const SENTENCE_WINDOW = 32;
/** How far past the target to look for a word break, when no sentence ends. */
const WORD_WINDOW = 16;
/**
 * Backlog past which a part is cut with no boundary at all. Without this an
 * unbroken run -- a long URL, a base64 blob -- has no break to land on and the
 * reveal would sit on it until the stream ended.
 */
const FORCE_AFTER_CHARS = 120;

const SENTENCE_END = /[.!?:;\n]/;
const isBreak = (char: string) => char === ' ' || char === '\t' || char === '\n';

/** End of the first sentence in `[at, upto)`, or 0 if none finishes there. */
function sentenceEnd(text: string, at: number, upto: number): number {
  for (let i = at; i < upto; i++) {
    if (!SENTENCE_END.test(text[i])) continue;
    // A period inside a number or an abbreviation is not a sentence end.
    if (i + 1 < text.length && !isBreak(text[i + 1])) continue;
    return i + 1;
  }
  return 0;
}

/** Last word break in `(from, upto)`, as the index just after it. */
function lastBreak(text: string, from: number, upto: number): number {
  for (let i = upto - 1; i > from; i--) {
    if (isBreak(text[i])) return i + 1;
  }
  return 0;
}

/** First word break in `[at, upto)`, as the index just after it. */
function nextBreak(text: string, at: number, upto: number): number {
  for (let i = at; i < upto; i++) {
    if (isBreak(text[i])) return i + 1;
  }
  return 0;
}

/**
 * Where the next part should end, or 0 if it is better to wait.
 *
 * Waiting matters: cutting a part mid-word would fade in half a word and then
 * the other half, which is precisely the character-by-character look this
 * avoids. Once the stream is `drained` there is nothing left to wait for, so
 * whatever remains is taken as-is.
 */
function partEnd(text: string, from: number, target: number, drained: boolean): number {
  const limit = text.length;

  if (target >= limit) {
    if (drained) return limit;
    // Show only as far as the last word that has definitely arrived.
    return lastBreak(text, from, limit);
  }

  const sentence = sentenceEnd(text, target, Math.min(limit, target + SENTENCE_WINDOW));
  if (sentence > from) return sentence;

  const back = lastBreak(text, from, target);
  if (back > from) return back;

  const forward = nextBreak(text, target, Math.min(limit, target + WORD_WINDOW));
  if (forward > from) return forward;

  if (drained || limit - from >= FORCE_AFTER_CHARS) return Math.min(limit, target);
  return 0;
}

export type Reveal = {
  /** Report the full text received so far. Safe to call with unchanged text. */
  push: (fullText: string) => void;
  /** Reveal everything received immediately (Stop pressed, or an error). */
  settle: () => void;
  /** Stop pacing and resolve once everything received has been revealed. */
  finish: () => Promise<void>;
  /** Abandon the reveal without draining. */
  cancel: () => void;
  /** What is currently visible. */
  visible: () => string;
};

export function createReveal(
  /**
   * Called with everything revealed so far, plus the offset the newest part
   * starts at -- the span `[from, visible.length)` is what has not been seen yet
   * and is the only thing the view needs to animate.
   */
  onPart: (visible: string, from: number) => void,
  /**
   * Abort for the turn being revealed. Once it fires the reveal stops writing and
   * any pending `finish()` resolves at once -- otherwise Stop would leave the
   * frame loop draining into a turn the store has already marked finished, which
   * re-flags it as pending.
   */
  signal?: { aborted: boolean },
): Reveal {
  let received = '';
  let shown = 0;
  let frame: number | null = null;
  let lastEmit = 0;
  let done = false;
  // Resolved by whichever of drain / settle / cancel gets there first.
  let resolveFinish: (() => void) | null = null;

  const settleFinish = () => {
    const resolve = resolveFinish;
    resolveFinish = null;
    resolve?.();
  };

  const stop = () => {
    if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
  };

  const emit = (from: number) => {
    lastEmit = Date.now();
    onPart(received.slice(0, shown), from);
  };

  const tick = () => {
    frame = null;

    if (signal?.aborted) {
      done = true;
      settleFinish();
      return;
    }

    if (received.length - shown <= 0) {
      // Nothing outstanding: `push` will restart the loop. Only `finish` decides
      // whether this is the end.
      if (done) settleFinish();
      return;
    }

    // Hold the part rate even when text is arriving faster than that.
    if (Date.now() - lastEmit < PART_INTERVAL_MS) {
      frame = requestAnimationFrame(tick);
      return;
    }

    const backlog = received.length - shown;
    const target = shown + Math.max(BASE_PART_CHARS, Math.ceil(backlog / CATCH_UP_DIVISOR));
    const end = partEnd(received, shown, target, done);

    if (end > shown) {
      const from = shown;
      shown = end;
      emit(from);
    }

    if (shown < received.length || !done) {
      frame = requestAnimationFrame(tick);
    } else {
      settleFinish();
    }
  };

  const schedule = () => {
    if (frame === null) frame = requestAnimationFrame(tick);
  };

  return {
    push: (fullText) => {
      if (fullText.length === received.length) return;
      received = fullText;
      schedule();
    },
    settle: () => {
      stop();
      done = true;
      if (shown !== received.length) {
        const from = shown;
        shown = received.length;
        emit(from);
      }
      settleFinish();
    },
    finish: () =>
      new Promise<void>((resolve) => {
        done = true;
        if (shown >= received.length || signal?.aborted) {
          resolve();
          return;
        }
        resolveFinish = resolve;
        schedule();
      }),
    cancel: () => {
      stop();
      done = true;
      settleFinish();
    },
    visible: () => received.slice(0, shown),
  };
}
