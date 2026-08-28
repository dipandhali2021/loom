import React from 'react';
import { Text } from 'react-native';
import { matchRanges } from '../lib/find';
import { useTheme } from '../theme/ThemeProvider';

/**
 * Plain text with a find-in-chat query marked in it.
 *
 * Nested `Text` rather than a wrapping view, so the highlight flows with the line
 * and wraps where the sentence wraps. The user's turn uses this directly; the
 * assistant's goes through `Markdown`, which does the same split inside its own
 * text runs because those also have a fade boundary to respect.
 *
 * The active match takes the solid colour and a dark label; the rest take the
 * translucent one and keep whatever colour they inherited. That is the difference
 * between "there are eleven of these" and "you are standing on this one".
 */
export function Highlight({
  text,
  query,
  /** Offset of the match the chevrons are on, when it is in this text. */
  activeStart,
}: {
  text: string;
  query?: string;
  activeStart?: number;
}) {
  const { colors } = useTheme();
  const ranges = query ? matchRanges(text, query) : [];
  if (ranges.length === 0) return <>{text}</>;

  const out: React.ReactNode[] = [];
  let at = 0;
  for (const [from, to] of ranges) {
    if (from > at) out.push(text.slice(at, from));
    const active = activeStart === from;
    out.push(
      <Text
        key={from}
        style={{
          backgroundColor: active ? colors.findMatchActive : colors.findMatch,
          ...(active ? { color: colors.findMatchOnText } : null),
        }}
      >
        {text.slice(from, to)}
      </Text>,
    );
    at = to;
  }
  if (at < text.length) out.push(text.slice(at));
  return <>{out}</>;
}
