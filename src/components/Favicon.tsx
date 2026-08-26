import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { ApiSource } from '../lib/api';

/**
 * The little round mark that stands for a cited site.
 *
 * Drawn locally rather than fetched. A real favicon needs a per-host request to
 * something like `google.com/s2/favicons?domain=<host>`, and that request tells a
 * third party every site the model read on the user's behalf -- which is a
 * different privacy posture than the app has anywhere else, so it is not adopted
 * silently. A monogram on a hue derived from the host is stable, offline, and
 * distinguishes the sources in a stack, which is all the mark has to do.
 *
 * Switching to real icons later is one function: return an `<Image>` here.
 */

/** Host without scheme, `www.`, path or port -- what a citation actually shows. */
export function hostOf(source: Pick<ApiSource, 'displayUrl' | 'url'>): string {
  const raw = (source.displayUrl || source.url || '').trim();
  return raw
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/^www\./i, '')
    .split('/')[0]
    .split(':')[0]
    .toLowerCase();
}

/**
 * A hue per host, so the same site is the same colour in the pill, the stack and
 * the sheet. Multiplying by 31 is the usual string hash; the point is only that it
 * is deterministic and spreads adjacent hosts apart.
 */
function hueOf(host: string): number {
  let hash = 0;
  for (let index = 0; index < host.length; index += 1) {
    hash = (hash * 31 + host.charCodeAt(index)) % 3_600;
  }
  return hash % 360;
}

/** First letter of the registrable name, which is the part a reader recognises. */
function initialOf(host: string): string {
  const letter = host.replace(/[^a-z0-9]/gi, '').charAt(0);
  return (letter || '?').toUpperCase();
}

export function Favicon({
  host,
  size = 18,
  ring,
}: {
  host: string;
  size?: number;
  /**
   * Colour of a border drawn around the circle. Only the stacked row needs it --
   * it is what separates one overlapping mark from the one behind it.
   */
  ring?: string;
}) {
  const hue = hueOf(host);

  return (
    <View
      style={[
        styles.mark,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: `hsl(${hue}, 44%, 42%)`,
        },
        ring ? { borderWidth: 1.5, borderColor: ring } : null,
      ]}
    >
      {/*
       * Sized off the circle rather than off the type ramp: the mark is drawn at
       * 12pt inside a pill and at 20pt in the sheet, and a fixed letter size would
       * either overflow the small one or float in the large one.
       */}
      <Text
        style={[styles.letter, { fontSize: Math.round(size * 0.56), lineHeight: size }]}
        allowFontScaling={false}
      >
        {initialOf(host)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  mark: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  // White on a mid-lightness hue passes contrast for every hue in the ramp, which
  // is why lightness is pinned at 42% rather than derived from the host too.
  letter: { color: '#FFFFFF', fontWeight: '700', textAlign: 'center' },
});
