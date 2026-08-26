import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Easing,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { CodeBlock } from './CodeBlock';
import { Favicon, hostOf } from './Favicon';
import { useTheme } from '../theme/ThemeProvider';
import type { ApiSource } from '../lib/api';
import { Align, Block, InlineNode, TableCell, parseMarkdown } from '../lib/markdown';
import { type } from '../theme/tokens';

/**
 * How long one revealed part takes to reach full strength.
 *
 * Deliberately shorter than the reveal's own gap between parts (PART_INTERVAL_MS
 * in src/lib/reveal.ts), which is what keeps this simple: at most one part is
 * ever mid-fade, so the text splits into a settled run plus one animating span
 * and nothing on screen is ever re-animated or cut short.
 */
const PART_FADE_MS = 170;

/** The inline citation pill: its height, and the site mark inside it. */
const CITE_HEIGHT = 20;
const CITE_MARK = 14;
/*
 * How far the pill is pushed down to land on the middle of the line.
 *
 * An inline view inside a `Text` gets no baseline alignment -- React Native sits its
 * bottom edge on the baseline, which for a 20pt pill against `chatBody`'s ~13pt cap
 * height leaves its centre about 3.5pt above the centre of the letters beside it.
 * That is the "riding high" look. A transform rather than a margin, so nothing about
 * where the paragraph wraps depends on it; the line has room for the descent because
 * `chatBody` is 18/25 and only ~21.5 of that is ink.
 */
const CITE_DROP = 4;

/** `[r, g, b, a]` from `#RGB`, `#RRGGBB`, `rgb(...)` or `rgba(...)`. */
function parseColor(value: string): [number, number, number, number] {
  if (value.startsWith('#')) {
    const hex = value.slice(1);
    const full = hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex;
    return [
      parseInt(full.slice(0, 2), 16),
      parseInt(full.slice(2, 4), 16),
      parseInt(full.slice(4, 6), 16),
      1,
    ];
  }
  const parts = value
    .replace(/^rgba?\(|\)$/g, '')
    .split(',')
    .map((n) => parseFloat(n));
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
}

const withAlpha = (rgba: [number, number, number, number], scale: number) =>
  `rgba(${rgba[0]},${rgba[1]},${rgba[2]},${rgba[3] * scale})`;

/**
 * Fades text in on mount, and only on mount: the animation is started from a ref
 * with an empty dep list, so a span that has already played keeps its final
 * appearance when it later stops counting as new.
 *
 * Both the colour's alpha and `opacity` are animated. React Native flattens
 * nested `Text` into one native string, and which of the two a platform honours
 * inside that string has differed by version -- driving both means the fade lands
 * either way, and where both apply the curve just steepens slightly. Colour is
 * why this cannot use the native driver.
 */
function FadeSpan({
  fade,
  color,
  extraStyle,
  children,
}: {
  fade: boolean;
  color: string;
  extraStyle?: object;
  children: React.ReactNode;
}) {
  const enter = useRef(new Animated.Value(fade ? 0 : 1)).current;
  const base = useMemo(() => parseColor(color), [color]);

  useEffect(() => {
    if (!fade) return;
    Animated.timing(enter, {
      toValue: 1,
      duration: PART_FADE_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
    // Mount only: `fade` going false later means the span has aged out of the
    // window, not that it should play again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animated = {
    opacity: enter,
    color: enter.interpolate({
      inputRange: [0, 1],
      outputRange: [withAlpha(base, 0), withAlpha(base, 1)],
    }),
  };

  return <Animated.Text style={[extraStyle, animated]}>{children}</Animated.Text>;
}

/** The same, for whole blocks -- a code fence or a rule arrives as one piece. */
function FadeBlock({ fade, children }: { fade: boolean; children: React.ReactNode }) {
  const enter = useRef(new Animated.Value(fade ? 0 : 1)).current;

  useEffect(() => {
    if (!fade) return;
    Animated.timing(enter, {
      toValue: 1,
      duration: PART_FADE_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View
      style={{
        opacity: enter,
        transform: [
          {
            translateY: enter.interpolate({
              inputRange: [0, 1],
              outputRange: [4, 0],
            }),
          },
        ],
      }}
    >
      {children}
    </Animated.View>
  );
}

type Ctx = {
  /**
   * Where the newest part starts. `null` for a reply that is not streaming -- one
   * loaded from history, or one that has finished -- in which case nothing fades.
   */
  boundary: number | null;
  colors: ReturnType<typeof useTheme>['colors'];
  /**
   * The host to draw a link as a citation pill for, or `null` to draw it as an
   * ordinary link. A closure rather than the source list itself, so the matching
   * rule lives in one place and the nodes just ask.
   */
  cite: (href: string) => string | null;
};

/**
 * Trailing slash and fragment dropped, so `example.com/a`, `example.com/a/` and
 * `example.com/a#top` are one URL. Query is kept -- it routinely selects the page.
 */
const normalizeUrl = (url: string) =>
  url.trim().replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase();

/**
 * Host per cited URL, for the pills.
 *
 * Keyed on the URL rather than matched by host, so a link the model wrote to a
 * site it did not read stays an ordinary link: the pill's whole claim is "this
 * sentence came from a source in the list below", and only a URL that is in that
 * list can make it.
 */
function citationIndex(sources: ApiSource[] | undefined): Map<string, string> {
  const index = new Map<string, string>();
  for (const source of sources ?? []) {
    const host = hostOf(source);
    if (host) index.set(normalizeUrl(source.url), host);
  }
  return index;
}

/**
 * An inline citation, drawn where the sentence it supports ends.
 *
 * A view nested inside a `Text`, which React Native lays out in the flow of the
 * line as long as its size is known -- which is why the pill's height is a constant
 * and the host has a `maxWidth` rather than either being left to the content. Its
 * bottom edge lands on the text baseline, which puts it a few points high against
 * the letters beside it, so `CITE_DROP` pushes it back onto the middle of the line.
 */
function CitePill({ host, href, colors }: { host: string; href: string; colors: Ctx['colors'] }) {
  return (
    <Pressable
      onPress={() => openLink(href)}
      style={[styles.cite, { backgroundColor: colors.fillQuaternary }]}
      accessibilityRole="link"
      accessibilityLabel={`Source: ${host}`}
    >
      <Favicon host={host} size={CITE_MARK} />
      <Text
        style={[type.caption1Medium, styles.citeHost, { color: colors.labelSecondary }]}
        numberOfLines={1}
      >
        {host}
      </Text>
    </Pressable>
  );
}

/**
 * The bracket or paren a citation was written inside, removed.
 *
 * The model writes `([Wikipedia](url))` and `[[1](url)]` and the parser, correctly,
 * hands the surrounding punctuation back as text: `"... ("`, the link, `")."`. It
 * was only ever there to make a bare URL readable, and the pill is already a
 * self-contained mark -- so what is left on screen is a stray bracket on each side
 * of something that does not need one.
 *
 * Only a group whose entire contents are pills is unwrapped, separators included,
 * so `(see [the docs](url) for more)` keeps its parens: those belong to the
 * sentence rather than to the citation.
 */
const OPENERS: Record<string, string> = { '(': ')', '[': ']' };

/** What may sit between two pills inside one group and still count as separators. */
const SEPARATOR = /^[\s,;]*$/;

function unwrapCitations(nodes: InlineNode[], ctx: Ctx): InlineNode[] {
  // Nothing resolves to a pill without sources, so the common case costs one scan.
  if (!nodes.some((node) => node.kind === 'link' && ctx.cite(node.href))) return nodes;

  const out = nodes.slice();

  for (let i = 0; i < out.length; i += 1) {
    const open = out[i];
    if (open.kind !== 'text') continue;
    const closer = OPENERS[open.text.slice(-1)];
    if (!closer) continue;

    // Everything from here to the closer must be a pill or a separator between two.
    let j = i + 1;
    let pills = 0;
    while (j < out.length) {
      const node = out[j];
      if (node.kind === 'link' && ctx.cite(node.href)) {
        pills += 1;
        j += 1;
        continue;
      }
      if (node.kind === 'text' && SEPARATOR.test(node.text) && j + 1 < out.length) {
        j += 1;
        continue;
      }
      break;
    }

    const end = out[j];
    if (pills === 0 || !end || end.kind !== 'text' || !end.text.startsWith(closer)) continue;

    // `start` moves with the slice on the closing side, so the reveal boundary still
    // points at the same character of the original text.
    out[i] = { ...open, text: open.text.slice(0, -1) };
    out[j] = { ...end, text: end.text.slice(1), start: end.start + 1 };
  }

  /*
   * The shape the pass above cannot see: `[[1](url)]`, where the group's own opening
   * bracket is the link's, consumed by the parser, leaving only the closer as text.
   * Dropping a `]` on sight is safe in a way dropping a `)` would not be -- prose
   * opens parentheses for its own reasons, but a closing square bracket that follows
   * a pill with no opener anywhere before it came from a citation.
   */
  for (let i = 1; i < out.length; i += 1) {
    const node = out[i];
    if (node.kind !== 'text' || !node.text.startsWith(']')) continue;
    const before = out[i - 1];
    if (before.kind !== 'link' || !ctx.cite(before.href)) continue;
    if (out.slice(0, i).some((n) => n.kind === 'text' && n.text.includes('['))) continue;
    out[i] = { ...node, text: node.text.slice(1), start: node.start + 1 };
  }

  // A group that was the whole node leaves an empty span behind.
  return out.filter((node) => node.kind !== 'text' || node.text.length > 0);
}

/** True for content in the part just handed over; everything else is settled. */
const isNew = (ctx: Ctx, at: number) => ctx.boundary !== null && at >= ctx.boundary;

function openLink(href: string) {
  Linking.openURL(href).catch(() => {
    // A malformed or unsupported href is not worth interrupting the reply for.
  });
}

/**
 * A run of plain text, split at the part boundary if it falls inside.
 *
 * The settled half is a plain `Text`: it is already at full strength, so it can
 * be rewritten freely as the reply grows -- which matters, because a text node's
 * extent does shift while Markdown resolves (`**nativ` is an open strong span
 * until its closer arrives). The new half is keyed by the boundary, so it mounts
 * when the part arrives and is replaced by the next one rather than edited.
 */
function textPieces(text: string, start: number, ctx: Ctx, color: string): React.ReactNode[] {
  const end = start + text.length;
  const at = ctx.boundary;

  if (at === null || at <= start) {
    // Entirely new, or entirely settled -- one span either way.
    return [
      at !== null && at <= start ? (
        <FadeSpan key={`n${start}`} fade color={color}>
          {text}
        </FadeSpan>
      ) : (
        <Text key={`p${start}`}>{text}</Text>
      ),
    ];
  }

  if (at >= end) return [<Text key={`p${start}`}>{text}</Text>];

  return [
    <Text key={`p${start}`}>{text.slice(0, at - start)}</Text>,
    <FadeSpan key={`n${at}`} fade color={color}>
      {text.slice(at - start)}
    </FadeSpan>,
  ];
}

// Flattened rather than nested, so every element in the returned list has a key.
function inlineNodes(nodes: InlineNode[], ctx: Ctx, color: string): React.ReactNode[] {
  return unwrapCitations(nodes, ctx).flatMap((node): React.ReactNode[] => {
    switch (node.kind) {
      case 'text':
        return textPieces(node.text, node.start, ctx, color);
      case 'code':
        return [
          <FadeSpan
            key={`c${node.start}`}
            fade={isNew(ctx, node.start)}
            color={color}
            extraStyle={{
              ...styles.inlineCode,
              backgroundColor: ctx.colors.fillQuaternary,
            }}
          >
            {node.text}
          </FadeSpan>,
        ];
      case 'strong':
        return [
          <Text key={`s${node.start}`} style={styles.strong}>
            {inlineNodes(node.children, ctx, color)}
          </Text>,
        ];
      case 'em':
        return [
          <Text key={`e${node.start}`} style={styles.em}>
            {inlineNodes(node.children, ctx, color)}
          </Text>,
        ];
      case 'strike':
        return [
          <Text key={`k${node.start}`} style={styles.strike}>
            {inlineNodes(node.children, ctx, color)}
          </Text>,
        ];
      case 'link': {
        /*
         * A link to one of the turn's own sources is drawn as a pill instead of as
         * its label: the model writes citations as `[anything](url)`, and what a
         * reader needs from one is which site it was, not whatever words the model
         * chose to hang it on.
         */
        const host = ctx.cite(node.href);
        if (host) {
          return [
            <CitePill key={`l${node.start}`} host={host} href={node.href} colors={ctx.colors} />,
          ];
        }
        return [
          <Text key={`l${node.start}`} style={styles.link} onPress={() => openLink(node.href)}>
            {inlineNodes(node.children, ctx, color)}
          </Text>,
        ];
      }
    }
  });
}

/**
 * Roughly how wide one character of `type.chatTable` runs.
 *
 * The column widths are estimated from character counts rather than measured,
 * and this is the whole reason that works: a measured layout needs two passes,
 * and mid-stream the table is re-laid out several times a second, so every one
 * of those passes would be visible as a twitch. A slight over-estimate is the
 * safe direction -- it leaves a little air rather than wrapping text early.
 */
const CHAR_WIDTH = 8.6;

/** Floor and ceiling on a column's *text* width, in points -- the gap is added after. */
const MIN_COLUMN = 54;
const MAX_COLUMN = 188;

/** Space between one column's text and the next one's. */
const COLUMN_GAP = 20;

const TEXT_ALIGN = { left: 'left', center: 'center', right: 'right' } as const;

/** Plain text of an inline run, for counting characters. */
function cellText(nodes: InlineNode[]): string {
  let out = '';
  for (const node of nodes) {
    if (node.kind === 'text' || node.kind === 'code') out += node.text;
    else out += cellText(node.children);
  }
  return out;
}

/**
 * One width per column, shared by every row.
 *
 * This is what makes the columns line up. Sizing each cell with `flex` instead
 * lets every row divide the leftover width on its own, so the same column lands
 * at a different x-position on each line and the table reads as ragged. Widths
 * come from the longest cell in the column, clamped, so a "Yes"/"No" column stays
 * narrow and a prose one wraps instead of pushing the table miles wide.
 */
function columnWidths(rows: TableCell[][], columns: number): number[] {
  return Array.from({ length: columns }, (_, column) => {
    let longest = 0;
    for (const row of rows) {
      const cell = row[column];
      if (cell) longest = Math.max(longest, cellText(cell.inline).trim().length);
    }
    const text = Math.max(MIN_COLUMN, Math.min(MAX_COLUMN, Math.ceil(longest * CHAR_WIDTH)));
    // The gap is padding inside the cell, so it has to be added on top of the text
    // width -- folded in, it would eat into the text and wrap a column early.
    return text + COLUMN_GAP;
  });
}

/**
 * One table, scrolling sideways when its columns cannot fit.
 *
 * Drawn the way the app draws it: no outer frame and no vertical dividers, just a
 * rule under the header and between rows. A full grid of borders is heavier than
 * the surrounding text and turns a small table into the loudest thing on screen.
 *
 * Rows are padded out to the header's column count. A model's last row is often
 * half-written mid-stream, and a short row would otherwise pull its columns wide.
 */
function TableView({
  header,
  rows,
  align,
  ctx,
}: {
  header: TableCell[];
  rows: TableCell[][];
  align: (Align | null)[];
  ctx: Ctx;
}) {
  const { colors } = ctx;
  const columns = Math.max(header.length, ...rows.map((row) => row.length), 1);
  // Header included: it is often the longest cell in a column of short values.
  const widths = useMemo(() => {
    const measured = columnWidths([header, ...rows], columns);
    // The last column carries no gap, so its width should not include one either.
    measured[columns - 1] -= COLUMN_GAP;
    return measured;
  }, [header, rows, columns]);

  const cells = (row: TableCell[], head: boolean) =>
    Array.from({ length: columns }, (_, column) => {
      const cell = row[column];
      const at = align[column];
      return (
        <View
          key={column}
          style={[
            styles.cell,
            { width: widths[column] },
            // No trailing gap on the last column: it has nothing to be separated
            // from, and the slack would push a table that just fits into scrolling.
            column === columns - 1 && styles.lastCell,
          ]}
        >
          <Text
            style={[
              type.chatTable,
              head ? styles.cellHead : null,
              { color: head ? colors.labelPrimary : colors.labelSecondary },
              // Left unless the delimiter row asked otherwise: a column of words
              // reads off its left edge, and centring is what made the old table
              // look like a spreadsheet.
              at ? { textAlign: TEXT_ALIGN[at] } : null,
            ]}
            selectable
          >
            {cell
              ? inlineNodes(cell.inline, ctx, head ? colors.labelPrimary : colors.labelSecondary)
              : ''}
          </Text>
        </View>
      );
    });

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.tableScroll}
      // Vertical scrolling belongs to the transcript; this one only pans sideways.
      directionalLockEnabled
    >
      {/*
       * `flexGrow` with fixed-width cells is deliberate: there is nothing flexible
       * to absorb the slack, so a narrow table keeps its column widths while the
       * rules still run the full width of the screen.
       */}
      <View style={styles.table}>
        <View
          style={[styles.tableRow, styles.tableHead, { borderColor: colors.separatorNonOpaque }]}
        >
          {cells(header, true)}
        </View>
        {rows.map((row, index) => (
          <View
            key={row[0]?.start ?? index}
            style={[styles.tableRow, { borderColor: colors.separatorNonOpaque }]}
          >
            {cells(row, false)}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const HEADING_STYLE = {
  1: type.chatH1,
  2: type.chatH2,
  3: type.chatH3,
} as const;
const headingStyle = (level: number) => HEADING_STYLE[Math.min(level, 3) as 1 | 2 | 3];

function BlockView({ block, ctx }: { block: Block; ctx: Ctx }) {
  const { colors } = ctx;
  const primary = colors.labelPrimary;
  const body = [type.chatBody, { color: primary }];

  switch (block.kind) {
    case 'heading':
      return (
        <Text style={[headingStyle(block.level), { color: primary }, styles.heading]} selectable>
          {inlineNodes(block.inline, ctx, primary)}
        </Text>
      );

    case 'paragraph':
      return (
        <Text style={body} selectable>
          {inlineNodes(block.inline, ctx, primary)}
        </Text>
      );

    case 'list':
      return (
        <View style={styles.list}>
          {block.items.map((item) => (
            <View key={item.start} style={[styles.item, { paddingLeft: item.depth * 16 }]}>
              {/* The marker is its own column so wrapped lines stay hung off it. */}
              <Text style={[body, styles.marker, { color: colors.labelSecondary }]}>
                {item.marker}
              </Text>
              <Text style={[body, styles.itemBody]} selectable>
                {inlineNodes(item.inline, ctx, primary)}
              </Text>
            </View>
          ))}
        </View>
      );

    case 'quote':
      return (
        <View style={[styles.quote, { borderLeftColor: colors.separatorNonOpaque }]}>
          {block.lines.map((line, index) => (
            <Text key={index} style={[body, { color: colors.labelSecondary }]} selectable>
              {inlineNodes(line, ctx, colors.labelSecondary)}
            </Text>
          ))}
        </View>
      );

    case 'code':
      return (
        <FadeBlock fade={isNew(ctx, block.start)}>
          <CodeBlock code={block.text} lang={block.lang} />
        </FadeBlock>
      );

    case 'table':
      return <TableView header={block.header} rows={block.rows} align={block.align} ctx={ctx} />;

    case 'rule':
      return (
        <FadeBlock fade={isNew(ctx, block.start)}>
          <View style={[styles.rule, { backgroundColor: colors.separatorNonOpaque }]} />
        </FadeBlock>
      );
  }
}

/**
 * Renders an assistant reply's Markdown, fading in each part as the reveal hands
 * it over.
 *
 * `revealFrom` is where the newest part starts. When it is absent -- a reply
 * loaded from history, which was never streamed on this device -- or once it has
 * reached the end of the text, nothing animates and the message simply draws.
 *
 * `sources` are the turn's citations, which turn links to those pages into pills.
 */
function MarkdownBase({
  text,
  revealFrom,
  sources,
}: {
  text: string;
  revealFrom?: number;
  sources?: ApiSource[];
}) {
  const { colors } = useTheme();
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  const cited = useMemo(() => citationIndex(sources), [sources]);
  const cite = useCallback((href: string) => cited.get(normalizeUrl(href)) ?? null, [cited]);
  // A boundary at or past the end means the reply is complete: nothing to fade.
  const boundary = revealFrom !== undefined && revealFrom < text.length ? revealFrom : null;
  const ctx: Ctx = { boundary, colors, cite };

  return (
    <View style={styles.root}>
      {blocks.map((block) => (
        <BlockView key={block.start} block={block} ctx={ctx} />
      ))}
    </View>
  );
}

export const Markdown = React.memo(MarkdownBase);

const styles = StyleSheet.create({
  // The reveal writes a new slice ~9 times a second, so block spacing is a gap on
  // the container rather than a margin each block has to agree on.
  root: { gap: 10 },
  heading: { marginTop: 2 },
  strong: { fontWeight: '700' },
  em: { fontStyle: 'italic' },
  strike: { textDecorationLine: 'line-through' },
  link: { textDecorationLine: 'underline' },
  /*
   * A fixed height is not cosmetic here: an inline view inside a `Text` is only
   * laid out once its size is known, and a pill measured from its content is the
   * shape that silently collapses on Android.
   */
  cite: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: CITE_HEIGHT,
    // Tighter on the left, where the round mark already carries its own inset.
    paddingLeft: 3,
    paddingRight: 7,
    borderRadius: CITE_HEIGHT / 2,
    transform: [{ translateY: CITE_DROP }],
  },
  // Capped rather than truncating at the line's edge: a long host would otherwise
  // decide where the paragraph wraps.
  citeHost: { maxWidth: 132 },
  inlineCode: { ...type.chatCode, borderRadius: 4 },
  list: { gap: 4 },
  item: { flexDirection: 'row' },
  // Wide enough for "10." so an ordered list's text edge stays straight.
  marker: { width: 26 },
  itemBody: { flex: 1 },
  quote: { borderLeftWidth: 3, paddingLeft: 12, gap: 2 },
  // Fills the width when the columns fit, and is allowed past it when they do not.
  tableScroll: { flexGrow: 1 },
  table: { flexGrow: 1 },
  // The only rules in the table: one under each row, none between columns.
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  // A shade heavier under the header, which is what separates it from the body
  // now that the header has no fill of its own.
  tableHead: { borderBottomWidth: 1 },
  /*
   * The gap lives on the cell rather than between them, so a column's text edge
   * is at a fixed offset from its own width and the columns read as straight
   * vertical runs. `width` is set inline, per column.
   */
  cell: { paddingRight: COLUMN_GAP, paddingVertical: 7 },
  lastCell: { paddingRight: 0 },
  cellHead: { fontWeight: '600' },
  rule: { height: StyleSheet.hairlineWidth },
});
