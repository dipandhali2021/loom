import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CodeBlock } from './CodeBlock';
import { useTheme } from '../theme/ThemeProvider';
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
  const parts = value.replace(/^rgba?\(|\)$/g, '').split(',').map((n) => parseFloat(n));
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
        transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [4, 0] }) }],
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
};

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
  return nodes.flatMap((node): React.ReactNode[] => {
    switch (node.kind) {
      case 'text':
        return textPieces(node.text, node.start, ctx, color);
      case 'code':
        return [
          <FadeSpan
            key={`c${node.start}`}
            fade={isNew(ctx, node.start)}
            color={color}
            extraStyle={{ ...styles.inlineCode, backgroundColor: ctx.colors.fillQuaternary }}
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
      case 'link':
        return [
          <Text key={`l${node.start}`} style={styles.link} onPress={() => openLink(node.href)}>
            {inlineNodes(node.children, ctx, color)}
          </Text>,
        ];
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
            {cell ? inlineNodes(cell.inline, ctx, head ? colors.labelPrimary : colors.labelSecondary) : ''}
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
        <View style={[styles.tableRow, styles.tableHead, { borderColor: colors.separatorNonOpaque }]}>
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

const HEADING_STYLE = { 1: type.chatH1, 2: type.chatH2, 3: type.chatH3 } as const;
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
              <Text style={[body, styles.marker, { color: colors.labelSecondary }]}>{item.marker}</Text>
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
 */
function MarkdownBase({ text, revealFrom }: { text: string; revealFrom?: number }) {
  const { colors } = useTheme();
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  // A boundary at or past the end means the reply is complete: nothing to fade.
  const boundary = revealFrom !== undefined && revealFrom < text.length ? revealFrom : null;
  const ctx: Ctx = { boundary, colors };

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
  tableRow: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
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
