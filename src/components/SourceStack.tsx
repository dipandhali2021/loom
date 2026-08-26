import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from './AppText';
import { Favicon, hostOf } from './Favicon';
import { useTheme } from '../theme/ThemeProvider';
import type { ApiSource } from '../lib/api';

/**
 * The "Sources" affordance in a finished reply's action row: a few overlapping
 * site marks and a word, opening the full list.
 *
 * Stacked rather than listed. The citations are already in the prose, next to the
 * sentences they support -- this is only the way to the complete list, so it is
 * sized like one more control in the row instead of a block of its own. Three
 * marks is enough to say "several sites" without turning into a strip.
 */

const MARK_SIZE = 20;
/** How much of each mark the next one covers. Enough to read as a stack. */
const OVERLAP = 7;
const MAX_MARKS = 3;

export function SourceStack({ sources, onPress }: { sources: ApiSource[]; onPress: () => void }) {
  const { colors } = useTheme();
  if (sources.length === 0) return null;

  /*
   * De-duplicated by host: a reply that read three pages of the same site would
   * otherwise stack three identical marks, which says less than one does.
   */
  const hosts: string[] = [];
  for (const source of sources) {
    const host = hostOf(source);
    if (host && !hosts.includes(host)) hosts.push(host);
  }
  const shown = hosts.slice(0, MAX_MARKS);

  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={styles.wrap}
      accessibilityRole="button"
      accessibilityLabel={sources.length === 1 ? '1 source' : `${sources.length} sources`}
      accessibilityHint="Opens the list of sites this reply used"
    >
      <View style={styles.stack}>
        {shown.map((host, index) => (
          <View
            key={host}
            style={[
              index > 0 ? { marginLeft: -OVERLAP } : null,
              /*
               * Descending, so the first mark is the one fully visible. Later
               * siblings draw on top by default, which would leave the leftmost
               * mark as the one bitten into -- the stack reads as a pile with its
               * top card on the left, the way overlapping avatars do everywhere.
               */
              { zIndex: MAX_MARKS - index },
            ]}
          >
            {/* The ring is the page colour rather than a border colour: it is what
                cuts each mark out of the one behind it. */}
            <Favicon host={host} size={MARK_SIZE} ring={colors.bgPrimary} />
          </View>
        ))}
      </View>

      <AppText variant="footnote" tone="secondary">
        Sources
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  stack: { flexDirection: 'row', alignItems: 'center' },
});
