/**
 * Small Markdown parser for assistant replies.
 *
 * Hand-rolled rather than a library because the streaming renderer needs two
 * things no general parser offers: source offsets on every node (so the reveal
 * can fade in only the text that arrived this chunk), and tolerance for
 * half-written syntax -- mid-stream a reply constantly reads `**bo`, and showing
 * the asterisks until the closer lands is exactly the raw-markdown flicker this
 * is here to remove. Unclosed emphasis is therefore treated as open, not literal.
 *
 * Scope is what a chat model actually emits: headings, emphasis, code, quotes,
 * lists, rules and GFM pipe tables. Reference-style links (`[a][b]`) are not
 * supported and fall through as literal text.
 */

export type InlineNode =
  /** `start` is the offset of `text` itself, so a fade boundary can split it. */
  | { kind: 'text'; text: string; start: number }
  | { kind: 'code'; text: string; start: number }
  | { kind: 'strong'; children: InlineNode[]; start: number }
  | { kind: 'em'; children: InlineNode[]; start: number }
  | { kind: 'strike'; children: InlineNode[]; start: number }
  | { kind: 'link'; href: string; children: InlineNode[]; start: number };

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; inline: InlineNode[]; start: number }
  | { kind: 'paragraph'; inline: InlineNode[]; start: number }
  | { kind: 'code'; text: string; lang: string | null; start: number }
  /** Each entry is one quoted line, keeping its own offset. */
  | { kind: 'quote'; lines: InlineNode[][]; start: number }
  | { kind: 'list'; ordered: boolean; items: ListItem[]; start: number }
  /**
   * A GFM pipe table. `align` is per column and parallel to `header`; a `null`
   * entry is a column the delimiter row left unaligned. Rows are ragged on
   * purpose -- mid-stream the last one is usually half-written.
   */
  | {
      kind: 'table';
      header: TableCell[];
      rows: TableCell[][];
      align: (Align | null)[];
      start: number;
    }
  | { kind: 'rule'; start: number };

export type Align = 'left' | 'center' | 'right';

export type TableCell = { inline: InlineNode[]; start: number };

export type ListItem = {
  inline: InlineNode[];
  /** Rendered marker: the bullet, or the source's own number. */
  marker: string;
  /** Nesting level from the source indent, capped so deep lists stay readable. */
  depth: number;
  start: number;
};

const ESCAPABLE = new Set([
  '\\',
  '`',
  '*',
  '_',
  '{',
  '}',
  '[',
  ']',
  '(',
  ')',
  '#',
  '+',
  '-',
  '.',
  '!',
  '>',
  '~',
  '|',
]);

const isSpace = (c: string | undefined) => c === undefined || c === ' ' || c === '\t' || c === '\n';
const isWordChar = (c: string | undefined) => c !== undefined && /[\w]/.test(c);

/**
 * True when the character at `i` is backslash-escaped. Counted rather than
 * checked, since `\\*` is an escaped backslash followed by a live asterisk.
 */
function isEscaped(src: string, i: number): boolean {
  let slashes = 0;
  for (let j = i - 1; j >= 0 && src[j] === '\\'; j--) slashes += 1;
  return slashes % 2 === 1;
}

/** `_` inside a word (snake_case, __init__) is not emphasis. */
function canOpenEmphasis(src: string, i: number, marker: string): boolean {
  if (isSpace(src[i + 1])) return false;
  if (marker === '_' && isWordChar(src[i - 1])) return false;
  return true;
}

/** The closer for a single-character emphasis run, or -1 while still open. */
function findEmphasisClose(src: string, from: number, marker: string): number {
  for (let j = from; j < src.length; j++) {
    if (src[j] !== marker || isEscaped(src, j)) continue;
    if (isSpace(src[j - 1])) continue;
    if (marker === '_' && isWordChar(src[j + 1])) continue;
    return j;
  }
  return -1;
}

/** The closer for a two-character run (`**`, `__`, `~~`), or -1 while open. */
function findRunClose(src: string, from: number, run: string): number {
  let at = from;
  while (at < src.length) {
    const found = src.indexOf(run, at);
    if (found === -1) return -1;
    // A run immediately after the opener is an empty span, not a closer.
    if (found !== from && !isEscaped(src, found)) return found;
    at = found + run.length;
  }
  return -1;
}

function matchLink(src: string, i: number): { label: string; href: string; next: number } | null {
  /*
   * The first `]` is not always this `[`'s partner. A citation written `[[1]](url)`
   * -- and models write that constantly -- closes an inner bracket first, and
   * bailing there left the whole thing on screen as characters. So a `]` that is
   * not followed by `(` is stepped over, but only when there is another `[` between
   * here and it: that nested opener is what would have claimed it, which leaves this
   * one still looking. Without that condition `[a] and [b](url)` would swallow the
   * prose between the two and come out as one link.
   */
  let close = src.indexOf(']', i + 1);
  while (close !== -1) {
    if (isEscaped(src, close)) {
      close = src.indexOf(']', close + 1);
      continue;
    }
    if (src[close + 1] === '(') break;
    if (!src.slice(i + 1, close).includes('[')) return null;
    close = src.indexOf(']', close + 1);
  }
  if (close === -1) return null;
  const end = src.indexOf(')', close + 2);
  if (end === -1) return null;
  return { label: src.slice(i + 1, close), href: src.slice(close + 2, end).trim(), next: end + 1 };
}

/**
 * Parses inline markup. `base` is the offset of `src` within the whole document,
 * so every node's `start` stays absolute however deeply it nests.
 */
export function parseInline(src: string, base = 0): InlineNode[] {
  const out: InlineNode[] = [];
  let buffer = '';
  let bufferStart = base;
  let i = 0;

  const flush = () => {
    if (!buffer) return;
    out.push({ kind: 'text', text: buffer, start: bufferStart });
    buffer = '';
  };
  const push = (char: string, at: number) => {
    if (!buffer) bufferStart = base + at;
    buffer += char;
  };

  while (i < src.length) {
    const char = src[i];

    if (char === '\\' && ESCAPABLE.has(src[i + 1] ?? '')) {
      push(src[i + 1], i);
      i += 2;
      continue;
    }

    if (char === '`') {
      let run = 0;
      while (src[i + run] === '`') run += 1;
      const fence = '`'.repeat(run);
      const close = src.indexOf(fence, i + run);
      flush();
      out.push({
        kind: 'code',
        text: close === -1 ? src.slice(i + run) : src.slice(i + run, close),
        start: base + i,
      });
      i = close === -1 ? src.length : close + run;
      continue;
    }

    const pair = src.slice(i, i + 2);
    if (pair === '**' || pair === '__' || pair === '~~') {
      const close = findRunClose(src, i + 2, pair);
      flush();
      out.push({
        kind: pair === '~~' ? 'strike' : 'strong',
        children: parseInline(
          close === -1 ? src.slice(i + 2) : src.slice(i + 2, close),
          base + i + 2,
        ),
        start: base + i,
      });
      i = close === -1 ? src.length : close + 2;
      continue;
    }

    if ((char === '*' || char === '_') && canOpenEmphasis(src, i, char)) {
      const close = findEmphasisClose(src, i + 1, char);
      flush();
      out.push({
        kind: 'em',
        children: parseInline(
          close === -1 ? src.slice(i + 1) : src.slice(i + 1, close),
          base + i + 1,
        ),
        start: base + i,
      });
      i = close === -1 ? src.length : close + 1;
      continue;
    }

    if (char === '[') {
      const link = matchLink(src, i);
      if (link) {
        flush();
        out.push({
          kind: 'link',
          href: link.href,
          children: parseInline(link.label, base + i + 1),
          start: base + i,
        });
        i = link.next;
        continue;
      }
    }

    push(char, i);
    i += 1;
  }

  flush();
  return out;
}

const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const HEADING = /^ {0,3}(#{1,6})\s*(.*)$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`~]*)/;
const BULLET = /^(\s*)([-*+])\s+(.*)$/;
const ORDERED = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;
const MAX_LIST_DEPTH = 3;

/** One cell of a table's delimiter row: `---`, `:--`, `--:`, `:-:`. */
const DELIM_CELL = /^:?-+:?$/;
/**
 * A delimiter row that is still arriving: nothing but pipes, dashes, colons and
 * spaces. Recognising one before it is finished is what keeps the pipes from
 * flashing as literal text for a frame or two mid-stream.
 */
const PARTIAL_DELIM = /^[|\s:-]+$/;
/** A row opener on its own -- `|`, with the first cell not yet typed. */
const BARE_PIPES = /^\s*\|[\s|]*$/;

type Line = { text: string; start: number };

/** Splits into lines that remember where they began, which is what keeps offsets exact. */
function toLines(src: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  for (const text of src.split('\n')) {
    lines.push({ text, start });
    start += text.length + 1;
  }
  return lines;
}

const listDepth = (indent: string) =>
  Math.min(MAX_LIST_DEPTH, Math.floor(indent.replace(/\t/g, '  ').length / 2));

/** True when every line from `from` on is empty -- i.e. nothing has arrived yet. */
const blankFrom = (lines: Line[], from: number) =>
  lines.slice(from).every((line) => line.text.trim() === '');

/** Raw text of one cell, with the offset of its trimmed content. */
type RawCell = { text: string; start: number };

/**
 * Splits a table row at its unescaped pipes, or `null` for a line that has none.
 *
 * Pipes inside a code span belong to the span (`` `a | b` `` is one cell), so the
 * scan tracks backtick runs. The outer pipes of `| a | b |` are dropped, which is
 * what lets the leading-pipe and bare `a | b` forms both parse.
 */
function rowCells(line: Line): RawCell[] | null {
  const raw = line.text;
  const cuts: number[] = [];
  let fence = 0;

  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    if (char === '`' && !isEscaped(raw, i)) {
      let run = 0;
      while (raw[i + run] === '`') run += 1;
      if (fence === 0) fence = run;
      else if (fence === run) fence = 0;
      i += run - 1;
      continue;
    }
    if (char === '|' && fence === 0 && !isEscaped(raw, i)) cuts.push(i);
  }

  if (cuts.length === 0) return null;

  const bounds: [number, number][] = [];
  let from = 0;
  for (const cut of cuts) {
    bounds.push([from, cut]);
    from = cut + 1;
  }
  bounds.push([from, raw.length]);

  // Only the outermost empties go: an empty cell in the middle is a real column.
  if (raw.slice(bounds[0][0], bounds[0][1]).trim() === '') bounds.shift();
  if (bounds.length > 0) {
    const last = bounds[bounds.length - 1];
    if (raw.slice(last[0], last[1]).trim() === '') bounds.pop();
  }

  return bounds.map(([a, b]) => {
    const slice = raw.slice(a, b);
    const lead = slice.length - slice.trimStart().length;
    return { text: slice.trim(), start: line.start + a + lead };
  });
}

const toCells = (cells: RawCell[]): TableCell[] =>
  cells.map((cell) => ({ inline: parseInline(cell.text, cell.start), start: cell.start }));

function cellAlign(text: string): Align | null {
  const left = text.startsWith(':');
  const right = text.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return null;
}

/** Column alignments if `line` is a complete delimiter row, else `null`. */
function delimiterRow(line: Line): (Align | null)[] | null {
  const cells = rowCells(line);
  if (!cells || cells.length === 0) return null;
  if (!cells.every((cell) => DELIM_CELL.test(cell.text))) return null;
  return cells.map((cell) => cellAlign(cell.text));
}

/**
 * Whether a table starts at `i`, and how its head is made up.
 *
 * A pipe row alone is not enough -- prose says "a | b" -- so a complete table
 * needs the delimiter row underneath, with the same number of columns. The two
 * looser cases exist only for the stream: a head whose delimiter is half-written,
 * and a head that is all that has arrived so far. Both require the leading pipe,
 * which is the form a model emits, so ordinary prose is never caught by them.
 */
function tableHead(
  lines: Line[],
  i: number,
): { header: RawCell[]; align: (Align | null)[]; next: number } | null {
  const header = rowCells(lines[i]);
  if (!header || header.length === 0) return null;

  const below = lines[i + 1];
  if (below) {
    const align = delimiterRow(below);
    if (align && align.length === header.length) return { header, align, next: i + 2 };
  }

  if (!lines[i].text.trimStart().startsWith('|')) return null;
  // Nothing but blanks after it: the rest of the table has not arrived yet.
  if (blankFrom(lines, i + 1)) return { header, align: [], next: i + 1 };
  /*
   * A delimiter row in progress. Only accepted as the last line in the text --
   * anywhere else, something followed it and it was never going to be one.
   */
  if (below && blankFrom(lines, i + 2) && PARTIAL_DELIM.test(below.text)) {
    const cells = rowCells(below);
    return { header, align: (cells ?? []).map((c) => cellAlign(c.text)), next: i + 2 };
  }
  return null;
}

export function parseMarkdown(src: string): Block[] {
  const lines = toLines(src);
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.text.trim() === '') {
      i += 1;
      continue;
    }

    /*
     * A row opener with no cells yet (`|`) at the very end of the text: the start
     * of a table whose first cell has not arrived. Dropped rather than drawn, so
     * the pipe does not show for the frame before the header lands.
     */
    if (BARE_PIPES.test(line.text) && blankFrom(lines, i + 1)) {
      i += 1;
      continue;
    }

    const fence = FENCE.exec(line.text);
    if (fence) {
      const marker = fence[1][0].repeat(3);
      const body: string[] = [];
      i += 1;
      // An unterminated fence runs to the end: mid-stream that is the normal case.
      while (i < lines.length && !lines[i].text.trimStart().startsWith(marker)) {
        body.push(lines[i].text);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push({
        kind: 'code',
        text: body.join('\n'),
        lang: fence[2] || null,
        start: line.start,
      });
      continue;
    }

    if (RULE.test(line.text)) {
      blocks.push({ kind: 'rule', start: line.start });
      i += 1;
      continue;
    }

    const heading = HEADING.exec(line.text);
    if (heading) {
      const level = heading[1].length as 1 | 2 | 3 | 4 | 5 | 6;
      const at = line.start + line.text.indexOf(heading[2], heading[1].length);
      blocks.push({
        kind: 'heading',
        level,
        inline: parseInline(heading[2], at),
        start: line.start,
      });
      i += 1;
      continue;
    }

    if (QUOTE.test(line.text)) {
      const quoted: InlineNode[][] = [];
      const start = line.start;
      while (i < lines.length) {
        const match = QUOTE.exec(lines[i].text);
        if (!match) break;
        quoted.push(parseInline(match[1], lines[i].start + lines[i].text.length - match[1].length));
        i += 1;
      }
      blocks.push({ kind: 'quote', lines: quoted, start });
      continue;
    }

    /*
     * Table before list, since a delimiter row of `|:--|` would otherwise be read
     * as a bullet. Rows run until a line with no pipes, so an unfinished last row
     * is kept rather than dropped -- it is the one the reveal is fading in.
     */
    const head = tableHead(lines, i);
    if (head) {
      i = head.next;
      const rows: TableCell[][] = [];
      while (i < lines.length) {
        if (lines[i].text.trim() === '') break;
        const cells = rowCells(lines[i]);
        if (!cells) break;
        rows.push(toCells(cells));
        i += 1;
      }
      blocks.push({
        kind: 'table',
        header: toCells(head.header),
        rows,
        align: head.align,
        start: line.start,
      });
      continue;
    }

    const firstItem = BULLET.exec(line.text) ?? ORDERED.exec(line.text);
    if (firstItem) {
      const ordered = ORDERED.test(line.text);
      const items: ListItem[] = [];
      const start = line.start;
      while (i < lines.length) {
        const match = ordered ? ORDERED.exec(lines[i].text) : BULLET.exec(lines[i].text);
        if (!match) break;
        const content = match[3];
        const at = lines[i].start + lines[i].text.length - content.length;
        items.push({
          inline: parseInline(content, at),
          marker: ordered ? `${match[2]}.` : '•',
          depth: listDepth(match[1]),
          start: lines[i].start,
        });
        i += 1;
      }
      blocks.push({ kind: 'list', ordered, items, start });
      continue;
    }

    /*
     * Paragraph: every following line until a blank one or something that opens a
     * block. Sliced straight out of the source rather than rejoined, so offsets
     * stay usable for the fade boundary.
     */
    const start = line.start;
    let end = line.start + line.text.length;
    i += 1;
    while (i < lines.length) {
      const next = lines[i];
      if (
        next.text.trim() === '' ||
        RULE.test(next.text) ||
        HEADING.test(next.text) ||
        FENCE.test(next.text) ||
        QUOTE.test(next.text) ||
        BULLET.test(next.text) ||
        ORDERED.test(next.text) ||
        tableHead(lines, i) !== null
      ) {
        break;
      }
      end = next.start + next.text.length;
      i += 1;
    }
    blocks.push({ kind: 'paragraph', inline: parseInline(src.slice(start, end), start), start });
  }

  return blocks;
}
