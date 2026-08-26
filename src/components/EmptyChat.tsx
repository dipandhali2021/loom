import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { AppText } from './AppText';

/**
 * The body of a chat with nothing in it yet.
 *
 * Blank by default -- the design leaves the frame empty, so the composer is the only
 * thing asking for anything -- and holding the temporary chat's explanation when that
 * mode is on. The copy is faded rather than mounted on demand so turning the mode on
 * does not pop a paragraph into the middle of an otherwise still screen.
 */

/** Matches the nav bar's own swap, so the two halves of the toggle move together. */
const SWAP_DURATION = 260;
const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1);

/** How far the copy rises as it fades in, following `MessageRow`'s own FadeIn. */
const RISE = 6;

/**
 * Keeps the paragraph to a readable measure rather than the full screen width.
 *
 * Wider than it was, because the body text is now 16pt: at the old 300 the same
 * sentence broke into five short centred lines, which is the shape that reads as a
 * column of fragments rather than a paragraph.
 */
const COPY_MAX_WIDTH = 340;

export function EmptyChat({ temporary }: { temporary: boolean }) {
  // Seeded from the prop, so a temporary chat opened from cold shows its copy
  // already in place rather than fading it in over a screen the user is looking at.
  const progress = useSharedValue(temporary ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(temporary ? 1 : 0, {
      duration: SWAP_DURATION,
      easing: EASE_OUT,
    });
  }, [progress, temporary]);

  const copy = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: RISE * (1 - progress.value) }],
  }));

  return (
    <Animated.View style={[styles.body, copy]} pointerEvents="none">
      <AppText variant="emptyTitle" style={styles.heading}>
        Temporary chat
      </AppText>
      <AppText variant="emptyBody" tone="secondary" style={styles.paragraph}>
        This chat won&rsquo;t appear in your chat history, and won&rsquo;t be used to train our
        models. For safety, we may keep a copy of this chat for up to 30 days.
      </AppText>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // No horizontal inset: the screen's own empty frame already carries chatPadding.
  body: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // 10pt rather than 8: the heading grew to 28pt, and the old gap left the two
  // blocks touching closely enough to read as one wrapped sentence.
  heading: { textAlign: 'center', marginBottom: 10 },
  paragraph: { textAlign: 'center', maxWidth: COPY_MAX_WIDTH },
});
