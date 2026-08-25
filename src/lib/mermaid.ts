/**
 * Mermaid flowchart parser and layout.
 *
 * Real Mermaid is a browser library: it parses to a graph, hands that to dagre,
 * and emits SVG through the DOM. None of that runs here, and the usual way round
 * it -- a WebView with the library inside -- costs a native dependency and a whole
 * web view per diagram in a scrolling transcript, then still cannot inherit the
 * app's type or colours. So this parses the subset a chat model actually writes
 * and lays it out directly, and `MermaidView` draws the result with the
 * `react-native-svg` already in the project.
 *
 * Supported: `graph`/`flowchart` in all four directions, the common node shapes,
 * arrow/open/dotted/thick edges with optional labels, and subgraphs (their nodes
 * are laid out normally; the grouping box is not drawn). Anything else -- a
 * sequence diagram, a state chart, a Gantt -- is reported unsupported so the
 * caller can fall back to showing the source, which is more useful than a wrong
 * picture.
 *
 * Layout is layered: each node sits one level below the deepest thing pointing at
 * it, layers are packed along the flow direction and centred across it. That is
 * what a flowchart is for, and it needs no iteration -- worth having, since a
 * diagram is re-laid out repeatedly while the fence is still streaming.
 */

export type NodeShape = 'rect' | 'round' | 'stadium' | 'circle' | 'diamond' | 'hexagon';

export type EdgeStroke = 'solid' | 'dotted' | 'thick';

export type Direction = 'TB' | 'BT' | 'LR' | 'RL';

type ParsedNode = { id: string; label: string; shape: NodeShape };
type ParsedEdge = { from: string; to: string; label: string | null; stroke: EdgeStroke; arrow: boolean };

export type LaidOutNode = ParsedNode & { x: number; y: number; width: number; height: number };

export type LaidOutEdge = ParsedEdge & {
  /** Polyline through which the edge is drawn, already clipped to both boxes. */
  points: { x: number; y: number }[];
  /** Where the edge's label sits, or `null` when it has none. */
  label: string | null;
  labelX: number;
  labelY: number;
  labelWidth: number;
};

export type Diagram = {
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
  width: number;
  height: number;
};

/** Roughly one character of `type.chatDiagram`, for sizing boxes without measuring. */
const CHAR_WIDTH = 6.9;
const LINE_HEIGHT = 15;
/** Longest label line before it wraps, in characters. */
const WRAP_AT = 18;
const PADDING_X = 14;
const PADDING_Y = 9;
const MIN_WIDTH = 46;
/** Space between one layer and the next, along the flow. */
const LAYER_GAP = 46;
/** Space between siblings, across the flow. */
const SIBLING_GAP = 18;
/** Room for the arrowhead, kept clear of the target box. */
const ARROW = 7;
const PAD = 6;

/*
 * Node openers, longest first.
 *
 * Order is the whole correctness of this table: `[[` has to be tried before `[`,
 * and `((` before `(`, or every double-bracket shape parses as its single-bracket
 * cousin with a stray bracket in the label.
 */
const SHAPES: { open: string; close: string; shape: NodeShape }[] = [
  { open: '[[', close: ']]', shape: 'rect' },
  { open: '[(', close: ')]', shape: 'rect' },
  { open: '((', close: '))', shape: 'circle' },
  { open: '{{', close: '}}', shape: 'hexagon' },
  { open: '([', close: '])', shape: 'stadium' },
  { open: '[/', close: '/]', shape: 'rect' },
  { open: '[\\', close: '\\]', shape: 'rect' },
  { open: '[', close: ']', shape: 'rect' },
  { open: '(', close: ')', shape: 'round' },
  { open: '{', close: '}', shape: 'diamond' },
  { open: '>', close: ']', shape: 'rect' },
];

/** Arrow forms, longest first for the same reason as the shapes. */
const LINKS: { pattern: RegExp; stroke: EdgeStroke; arrow: boolean }[] = [
  { pattern: /^-\.-+>/, stroke: 'dotted', arrow: true },
  { pattern: /^-\.-+/, stroke: 'dotted', arrow: false },
  { pattern: /^={2,}>/, stroke: 'thick', arrow: true },
  { pattern: /^={2,}/, stroke: 'thick', arrow: false },
  { pattern: /^-{2,}>/, stroke: 'solid', arrow: true },
  { pattern: /^-{3,}/, stroke: 'solid', arrow: false },
];

const DIRECTIONS: Record<string, Direction> = {
  TB: 'TB', TD: 'TB', BT: 'BT', LR: 'LR', RL: 'RL',
};

/** Lines that configure rather than describe, and are skipped wholesale. */
const IGNORED = /^(classDef|class|style|linkStyle|click|direction|accTitle|accDescr)\b/;

/*
 * What a node id may contain.
 *
 * Deliberately narrow: `-` and `.` are legal in a Mermaid id, but allowing either
 * makes `A-->B` read as an id of `A--` with no arrow after it, and an arrow that
 * does not parse loses the whole edge. Every id a model writes is a word, so the
 * arrow wins the character.
 */
const ID_CHAR = /[A-Za-z0-9_]/;

/** Strips the quotes and `<br>` markup Mermaid allows inside a label. */
function cleanLabel(raw: string): string {
  return raw
    .trim()
    .replace(/^"(.*)"$/s, '$1')
    .replace(/^'(.*)'$/s, '$1')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .trim();
}

/** Wraps a label to `WRAP_AT`, honouring any newline it already contains. */
export function wrapLabel(label: string): string[] {
  const lines: string[] = [];
  for (const paragraph of label.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (!line) line = word;
      else if (line.length + 1 + word.length <= WRAP_AT) line += ` ${word}`;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines.length ? lines : [''];
}

type Ref = { id: string; label: string | null; shape: NodeShape | null; next: number };

/**
 * Reads one node reference at `at`: an id, plus a shape and label if this is
 * where the node is declared. A later bare `A` in another edge finds the node
 * already carrying its label, which is how Mermaid itself behaves.
 */
function readRef(src: string, at: number): Ref | null {
  let i = at;
  while (i < src.length && src[i] === ' ') i += 1;
  const start = i;
  while (i < src.length && ID_CHAR.test(src[i])) i += 1;
  if (i === start) return null;
  const id = src.slice(start, i);

  for (const { open, close, shape } of SHAPES) {
    if (!src.startsWith(open, i)) continue;
    const end = src.indexOf(close, i + open.length);
    if (end === -1) {
      // Half-written mid-stream: take what is there and keep the shape.
      return { id, label: cleanLabel(src.slice(i + open.length)), shape, next: src.length };
    }
    return {
      id,
      label: cleanLabel(src.slice(i + open.length, end)),
      shape,
      next: end + close.length,
    };
  }
  return { id, label: null, shape: null, next: i };
}

/** Matches a link at `at`, including a `|text|` or `-- text --` label. */
function readLink(
  src: string,
  at: number,
): { stroke: EdgeStroke; arrow: boolean; label: string | null; next: number } | null {
  let i = at;
  while (i < src.length && src[i] === ' ') i += 1;

  // `A -- text --> B`: the label sits inside the link itself.
  const inline = /^(-{2}|-\.|={2})\s([^-=|][\s\S]*?)\s(-{2,}>|-{2,}|-\.-+>|={2,}>|={2,})/.exec(src.slice(i));
  if (inline) {
    const tail = inline[3];
    const arrow = tail.endsWith('>');
    const stroke: EdgeStroke = inline[1] === '==' ? 'thick' : inline[1] === '-.' ? 'dotted' : 'solid';
    return { stroke, arrow, label: cleanLabel(inline[2]), next: i + inline[0].length };
  }

  const link = LINKS.find(({ pattern }) => pattern.test(src.slice(i)));
  if (!link) return null;
  const matched = link.pattern.exec(src.slice(i))!;
  i += matched[0].length;

  // `A -->|text| B`: the label follows the arrow.
  if (src[i] === '|') {
    const close = src.indexOf('|', i + 1);
    const end = close === -1 ? src.length : close;
    return {
      stroke: link.stroke,
      arrow: link.arrow,
      label: cleanLabel(src.slice(i + 1, end)),
      next: close === -1 ? src.length : close + 1,
    };
  }
  return { stroke: link.stroke, arrow: link.arrow, label: null, next: i };
}

export type ParseResult =
  | { ok: true; direction: Direction; nodes: ParsedNode[]; edges: ParsedEdge[] }
  /** `reason` names the diagram type, so the caller can say what it fell back from. */
  | { ok: false; reason: string };

/** The keyword on the first line, which is what decides whether this is drawable. */
const HEADER = /^\s*(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|gitGraph|mindmap|timeline|quadrantChart|requirementDiagram|C4Context|sankey(?:-beta)?|xychart(?:-beta)?|block(?:-beta)?)\b\s*([A-Za-z]{2})?/;

/*
 * A first line that is nothing but a flowchart header, and a body that has at least
 * one link in it.
 *
 * Both halves are needed. The header alone is not enough -- `graph = {}` is a line
 * of real code in half a dozen languages, and `HEADER` would happily match it --
 * so the line has to be *only* the keyword and its direction, and something in the
 * source has to actually connect two nodes.
 */
const MERMAID_FIRST_LINE = /^(?:graph|flowchart)(?:\s+(?:TB|TD|BT|LR|RL))?\s*(?:;.*)?$/i;
const MERMAID_LINK = /(-{2,}>|-{3,}|-\.-+>?|={2,}>|={3,})/;

/**
 * Whether a fence's body reads as a Mermaid flowchart, label or no label.
 *
 * Needed because the label is not reliable: a model asked for a flowchart writes
 * the source into a bare ``` fence about as often as it labels it, and one of those
 * two renders while the other sits there as text. Deliberately narrow -- only the
 * two diagram types `parseMermaid` can draw, and only when the first meaningful
 * line is the header on its own, so a fence of real code is never mistaken for one.
 */
export function looksLikeMermaid(source: string): boolean {
  for (const raw of source.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('%%')) continue;
    if (!MERMAID_FIRST_LINE.test(line)) return false;
    return MERMAID_LINK.test(source);
  }
  return false;
}

export function parseMermaid(source: string): ParseResult {
  const header = HEADER.exec(source);
  if (!header) return { ok: false, reason: 'diagram' };
  if (header[1] !== 'graph' && header[1] !== 'flowchart') return { ok: false, reason: header[1] };

  const direction = DIRECTIONS[(header[2] ?? 'TB').toUpperCase()] ?? 'TB';

  // Insertion-ordered, which is also the layout's tie-break within a layer.
  const nodes = new Map<string, ParsedNode>();
  const edges: ParsedEdge[] = [];

  const touch = (ref: Ref) => {
    const existing = nodes.get(ref.id);
    if (!existing) {
      nodes.set(ref.id, { id: ref.id, label: ref.label ?? ref.id, shape: ref.shape ?? 'rect' });
      return;
    }
    // A declaration anywhere wins over the bare id an earlier edge left behind.
    if (ref.label !== null) existing.label = ref.label;
    if (ref.shape !== null) existing.shape = ref.shape;
  };

  const body = source.slice(header.index + header[0].length);
  for (const raw of body.split(/\n|;/)) {
    const line = raw.trim();
    if (!line || line.startsWith('%%')) continue;
    // Subgraph nodes are laid out with everything else; only the box is dropped.
    if (/^(subgraph\b|end$)/.test(line) || IGNORED.test(line)) continue;

    const first = readRef(line, 0);
    if (!first) continue;
    touch(first);

    /*
     * One ref, then link-and-ref for as long as the line keeps going. The ref is
     * read once outside the loop on purpose: after an edge the cursor sits on the
     * *next link*, not on a node, so re-reading a ref at the top of each turn is
     * what drops the second half of `A --> B --> C`.
     */
    let at = first.next;
    let previous = first;
    while (at < line.length) {
      const link = readLink(line, at);
      if (!link) break;
      const target = readRef(line, link.next);
      if (!target) break;
      touch(target);
      edges.push({
        from: previous.id,
        to: target.id,
        label: link.label,
        stroke: link.stroke,
        arrow: link.arrow,
      });
      at = target.next;
      previous = target;
    }
  }

  if (nodes.size === 0) return { ok: false, reason: 'flowchart' };
  return { ok: true, direction, nodes: [...nodes.values()], edges };
}

/**
 * Which layer each node belongs to.
 *
 * A node sits one past the deepest thing pointing at it. Cycles are legal in a
 * flowchart -- a retry arrow back to an earlier step is the commonest shape there
 * is -- so the edges that close one are found first and left out of the ranking;
 * they are still drawn, just pointing against the flow. Without that step the
 * ranking has no fixed point at all: every pass pushes the cycle's nodes one layer
 * further down, and the chart comes out in the order the passes ran out.
 */
function layerOf(nodes: ParsedNode[], edges: ParsedEdge[]): Map<string, number> {
  const outgoing = new Map<string, ParsedEdge[]>(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    if (edge.from !== edge.to) outgoing.get(edge.from)?.push(edge);
  }

  /** Edges to a node still open on the walk -- i.e. the ones closing a cycle. */
  const back = new Set<ParsedEdge>();
  /** 0 unvisited, 1 open on the current path, 2 finished. */
  const state = new Map<string, 0 | 1 | 2>();

  // Iterative rather than recursive: a long chain is exactly what a flowchart is,
  // and recursion would put its whole depth on the JS stack.
  for (const root of nodes) {
    if (state.get(root.id)) continue;
    state.set(root.id, 1);
    const stack: { id: string; at: number }[] = [{ id: root.id, at: 0 }];
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const out = outgoing.get(frame.id) ?? [];
      if (frame.at >= out.length) {
        state.set(frame.id, 2);
        stack.pop();
        continue;
      }
      const edge = out[frame.at];
      frame.at += 1;
      const seen = state.get(edge.to) ?? 0;
      if (seen === 1) back.add(edge);
      else if (seen === 0) {
        state.set(edge.to, 1);
        stack.push({ id: edge.to, at: 0 });
      }
    }
  }

  const forward = edges.filter((edge) => edge.from !== edge.to && !back.has(edge));
  const layer = new Map(nodes.map((node) => [node.id, 0]));
  // Longest path by relaxation. Bounded by the node count, which is the most any
  // node's rank can be, so this terminates whatever the edges look like.
  for (let pass = 0; pass < nodes.length; pass++) {
    let moved = false;
    for (const edge of forward) {
      const want = (layer.get(edge.from) ?? 0) + 1;
      if (want > (layer.get(edge.to) ?? 0)) {
        layer.set(edge.to, want);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return layer;
}

const labelWidth = (lines: string[]) =>
  Math.max(...lines.map((line) => line.length)) * CHAR_WIDTH;

function sizeOf(node: ParsedNode): { width: number; height: number } {
  const lines = wrapLabel(node.label);
  const text = labelWidth(lines);
  const height = lines.length * LINE_HEIGHT + PADDING_Y * 2;

  if (node.shape === 'circle') {
    // A circle has to contain the label on the diagonal, so it grows both ways.
    const side = Math.max(MIN_WIDTH, text + PADDING_X * 2, height) * 1.15;
    return { width: side, height: side };
  }
  // A diamond's corners cut into its own box, so its label needs the extra room.
  const slack = node.shape === 'diamond' ? 1.5 : node.shape === 'hexagon' ? 1.2 : 1;
  return {
    width: Math.max(MIN_WIDTH, text + PADDING_X * 2 * slack),
    height: node.shape === 'diamond' ? height * 1.35 : height,
  };
}

/** Where a line from `to` towards a box's centre crosses that box's edge. */
function clip(
  box: { x: number; y: number; width: number; height: number },
  towards: { x: number; y: number },
  inset: number,
): { x: number; y: number } {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const dx = towards.x - cx;
  const dy = towards.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };

  const halfW = box.width / 2 + inset;
  const halfH = box.height / 2 + inset;
  // Scale the direction until it lands on whichever side it leaves through.
  const scale = Math.min(
    dx === 0 ? Infinity : halfW / Math.abs(dx),
    dy === 0 ? Infinity : halfH / Math.abs(dy),
  );
  return { x: cx + dx * scale, y: cy + dy * scale };
}

/**
 * Positions every node and routes every edge.
 *
 * Layers are stacked along the flow direction and each is centred across it, so a
 * chart reads down (or across) its own axis with the widest layer setting the
 * overall size. Edges are drawn straight between box edges, with the arrowhead's
 * length held clear of the target so the head sits against the border rather than
 * under it.
 */
export function layoutMermaid(parsed: Extract<ParseResult, { ok: true }>): Diagram {
  const { direction, nodes, edges } = parsed;
  const vertical = direction === 'TB' || direction === 'BT';
  const layers = layerOf(nodes, edges);

  const sizes = new Map(nodes.map((node) => [node.id, sizeOf(node)]));

  // Grouped by layer, keeping declaration order inside each one.
  const byLayer = new Map<number, ParsedNode[]>();
  for (const node of nodes) {
    const at = layers.get(node.id) ?? 0;
    const group = byLayer.get(at);
    if (group) group.push(node);
    else byLayer.set(at, [node]);
  }

  const depth = Math.max(...byLayer.keys()) + 1;
  const order = [...Array(depth).keys()];
  // BT and RL are the same layout read from the far end.
  const flipped = direction === 'BT' || direction === 'RL' ? [...order].reverse() : order;

  /** Extent of each layer along the flow, and across it. */
  const along = flipped.map((index) => {
    const group = byLayer.get(index) ?? [];
    return Math.max(0, ...group.map((n) => (vertical ? sizes.get(n.id)!.height : sizes.get(n.id)!.width)));
  });
  const across = flipped.map((index) => {
    const group = byLayer.get(index) ?? [];
    const sizesIn = group.map((n) => (vertical ? sizes.get(n.id)!.width : sizes.get(n.id)!.height));
    return sizesIn.reduce((sum, s) => sum + s, 0) + Math.max(0, group.length - 1) * SIBLING_GAP;
  });

  const crossExtent = Math.max(...across);
  const placed = new Map<string, LaidOutNode>();

  let offset = PAD;
  flipped.forEach((index, position) => {
    const group = byLayer.get(index) ?? [];
    // Centred across the flow against the widest layer, so the chart reads on axis.
    let cross = PAD + (crossExtent - across[position]) / 2;
    for (const node of group) {
      const size = sizes.get(node.id)!;
      const own = vertical ? size.width : size.height;
      // Centred within its own layer's band, so a short box in a tall row sits level.
      const center = offset + (along[position] - (vertical ? size.height : size.width)) / 2;
      placed.set(node.id, {
        ...node,
        x: vertical ? cross : center,
        y: vertical ? center : cross,
        width: size.width,
        height: size.height,
      });
      cross += own + SIBLING_GAP;
    }
    offset += along[position] + LAYER_GAP;
  });

  const routed: LaidOutEdge[] = edges.flatMap((edge) => {
    const from = placed.get(edge.from);
    const to = placed.get(edge.to);
    // A self-loop has nowhere to go in a layered layout, so it is left undrawn.
    if (!from || !to || from === to) return [];

    const fromCenter = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
    const toCenter = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
    const start = clip(from, toCenter, 0);
    const end = clip(to, fromCenter, edge.arrow ? ARROW : 0);

    const lines = edge.label ? wrapLabel(edge.label) : [];
    return [{
      ...edge,
      points: [start, end],
      label: edge.label,
      labelX: (start.x + end.x) / 2,
      labelY: (start.y + end.y) / 2,
      labelWidth: edge.label ? labelWidth(lines) + 8 : 0,
    }];
  });

  const width = (vertical ? crossExtent : offset - LAYER_GAP) + PAD * 2 - PAD;
  const height = (vertical ? offset - LAYER_GAP : crossExtent) + PAD * 2 - PAD;

  return { nodes: [...placed.values()], edges: routed, width, height };
}
