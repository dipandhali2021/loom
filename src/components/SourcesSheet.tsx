import React, { useCallback, useEffect, useState } from 'react';
import {
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from './AppText';
import { Favicon, hostOf } from './Favicon';
import { useTheme } from '../theme/ThemeProvider';
import { layout } from '../theme/tokens';
import type { ApiSource } from '../lib/api';

/**
 * The list behind a reply's stacked source marks.
 *
 * A Modal, unlike the attachment panel: that one has to occupy the keyboard's
 * layout slot, and this one is a true overlay over the transcript. So it follows
 * HistoryDrawer -- presented without animation, with the slide and the scrim both
 * driven off one shared value, which is what lets a downward drag scrub it.
 */

type Props = {
  visible: boolean;
  onClose: () => void;
  sources: ApiSource[];
};

const OPEN_DURATION = 300;
const CLOSE_DURATION = 220;
const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1);
const EASE_IN = Easing.bezier(0.4, 0, 1, 1);

/** Share of the screen the sheet is allowed to take, however many sources there are. */
const MAX_HEIGHT_RATIO = 0.72;

/** How far down a drag must get, as a share of the sheet, to count as closing. */
const CLOSE_FRACTION = 0.3;
const CLOSE_VELOCITY = 600;

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * "August 23", or nothing.
 *
 * The year is dropped for a date in the current year and kept otherwise, which is
 * the same rule a mail app uses: a citation from last week does not need to say
 * 2026, and one from 2019 very much needs to say 2019.
 */
function publishedLabel(iso: string | null): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const month = MONTHS[at.getMonth()];
  const now = new Date();
  return at.getFullYear() === now.getFullYear()
    ? `${month} ${at.getDate()}`
    : `${month} ${at.getDate()}, ${at.getFullYear()}`;
}

const open = (url: string) => {
  Linking.openURL(url).catch(() => {
    // A malformed href is not worth an alert over; the row simply does nothing.
  });
};

export function SourcesSheet({ visible, onClose, sources }: Props) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { height: windowHeight } = useWindowDimensions();

  const maxHeight = windowHeight * MAX_HEIGHT_RATIO;

  // Outlives `visible` so the exit has something to animate.
  const [mounted, setMounted] = useState(visible);
  // 0 = fully below the screen, 1 = fully up.
  const progress = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      progress.value = withTiming(1, {
        duration: OPEN_DURATION,
        easing: EASE_OUT,
      });
    } else {
      progress.value = withTiming(0, { duration: CLOSE_DURATION, easing: EASE_IN }, (finished) => {
        if (finished) runOnJS(setMounted)(false);
      });
    }
  }, [visible, progress]);

  const requestClose = useCallback(() => onClose(), [onClose]);

  /*
   * Translated rather than sized: the sheet's height is whatever its rows come to,
   * and animating that would re-lay the list out on every frame. Sliding a
   * finished box up from under the edge is one transform and costs nothing.
   */
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(progress.value, [0, 1], [maxHeight, 0]) }],
  }));

  const scrimStyle = useAnimatedStyle(() => ({
    opacity: progress.value * 0.5,
  }));

  /*
   * Drag down to dismiss, on the grabber and the heading above the list -- not on
   * the list itself, which has to stay scrollable. Only downward travel counts.
   */
  const pan = Gesture.Pan()
    .activeOffsetY(10)
    .failOffsetX([-24, 24])
    .onUpdate((event) => {
      const dragged = Math.max(0, event.translationY);
      progress.value = Math.max(0, 1 - dragged / maxHeight);
    })
    .onEnd((event) => {
      const shouldClose =
        event.translationY > maxHeight * CLOSE_FRACTION || event.velocityY > CLOSE_VELOCITY;
      if (shouldClose) {
        progress.value = withTiming(0, {
          duration: CLOSE_DURATION,
          easing: EASE_IN,
        });
        runOnJS(requestClose)();
      } else {
        progress.value = withTiming(1, {
          duration: OPEN_DURATION,
          easing: EASE_OUT,
        });
      }
    });

  if (!mounted) return null;

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={requestClose}
    >
      {/* Gestures inside a Modal need their own root on Android. */}
      <GestureHandlerRootView style={styles.root}>
        <Animated.View style={[styles.scrimLayer, scrimStyle]}>
          <Pressable
            style={styles.scrim}
            onPress={requestClose}
            accessibilityRole="button"
            accessibilityLabel="Close sources"
          />
        </Animated.View>

        <Animated.View
          style={[
            styles.sheet,
            {
              maxHeight,
              backgroundColor: colors.groupedCard,
              paddingBottom: Math.max(insets.bottom, 12),
            },
            sheetStyle,
          ]}
        >
          {/* The header is the drag handle. The list below it keeps its own scroll. */}
          <GestureDetector gesture={pan}>
            <View style={styles.header}>
              <View style={[styles.grabber, { backgroundColor: colors.separatorOpaque }]} />
              <AppText variant="title3Bold">Sources</AppText>
            </View>
          </GestureDetector>

          <ScrollView
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            // The sheet is at most 72% tall, so a long list bounces inside itself
            // rather than looking like the sheet failed to open all the way.
            bounces
          >
            {sources.map((source, index) => {
              const host = hostOf(source);
              const date = publishedLabel(source.publishedAt);

              return (
                <Pressable
                  key={`${source.url}-${index}`}
                  onPress={() => open(source.url)}
                  style={({ pressed }) => [
                    styles.row,
                    index > 0 ? { borderTopColor: colors.separatorNonOpaque } : null,
                    index > 0 ? styles.rowDivided : null,
                    {
                      backgroundColor: pressed ? colors.rowActive : 'transparent',
                    },
                  ]}
                  accessibilityRole="link"
                  accessibilityLabel={`${source.title}, ${host}`}
                >
                  <View style={styles.rowHead}>
                    <Favicon host={host} size={18} />
                    <AppText
                      variant="footnote"
                      tone="secondary"
                      numberOfLines={1}
                      style={styles.host}
                    >
                      {host}
                    </AppText>
                  </View>

                  <AppText variant="calloutSemibold" numberOfLines={3}>
                    {source.title || source.url}
                  </AppText>

                  {/* Only what is known: a provider that returned no date gets no
                      line, rather than a guess or an em dash. */}
                  {date ? (
                    <AppText variant="footnote" tone="tertiary" numberOfLines={1}>
                      {date}
                    </AppText>
                  ) : null}

                  {!source.fetched ? (
                    <AppText variant="footnote" tone="tertiary" numberOfLines={1}>
                      Link only, page not read
                    </AppText>
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  scrimLayer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  scrim: { flex: 1, backgroundColor: '#000000' },
  sheet: {
    // Only the top corners: the sheet is flush with the bottom edge.
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  header: {
    paddingTop: 8,
    paddingHorizontal: layout.screenPadding,
    paddingBottom: 10,
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
    opacity: 0.5,
  },
  list: { paddingHorizontal: layout.screenPadding },
  // Generous vertical padding: each row is three lines of different sizes, and the
  // hairline between them is the only thing separating one citation from the next.
  row: { paddingVertical: 14, gap: 5 },
  rowDivided: { borderTopWidth: StyleSheet.hairlineWidth },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  host: { flexShrink: 1 },
});
