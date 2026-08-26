import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { AppText } from './AppText';
import { useTheme } from '../theme/ThemeProvider';

/**
 * What the wait for the first token looks like.
 *
 * Three static dots said "something is happening" and nothing else, which on a slow
 * first token is indistinguishable from a reply that has stalled. A ring that turns
 * and a word that changes both carry the one piece of information the dots could
 * not: that this is still going, and roughly what it is doing.
 */

/**
 * The words, in the order the wait actually passes through.
 *
 * Deliberately vague, and only used when there is nothing specific to say. A turn
 * that calls a tool sends progress frames the store puts on the message, and the row
 * passes those down as `label` -- so "Searching the web" is a fact when it appears
 * rather than a guess. These are the fallback for the ordinary case, where all that
 * is honestly known is that the request is out.
 */
const WORDS = [
  'Thinking',
  'Reading your message',
  'Working it out',
  'Pulling the pieces together',
  'Almost there',
];

/** How long each word holds before it hands over. */
const HOLD_MS = 1_800;
/** The swap itself: out fast, in a touch slower, so the arrival is what is noticed. */
const OUT_MS = 160;
const IN_MS = 220;
/** How far a word travels as it goes and as the next one arrives. */
const RISE = 7;

/** One turn of the ring. Slow enough to read as deliberate rather than frantic. */
const SPIN_MS = 1_100;

/** The breathe under the whole row, which is what keeps a held word from looking frozen. */
const PULSE_MS = 900;
const PULSE_FLOOR = 0.6;

const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1);
const EASE_IN = Easing.bezier(0.4, 0, 1, 1);

/** Ring geometry. The stroke is inset by half its width so it is not clipped. */
const RING_SIZE = 15;
const RING_STROKE = 2;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
/** Share of the circle that is drawn; the rest is the gap that makes the spin visible. */
const ARC = 0.3;

/** A turning arc, drawn rather than iconised so it can be a true partial circle. */
function Spinner({ color }: { color: string }) {
  const turn = useSharedValue(0);

  useEffect(() => {
    turn.value = withRepeat(withTiming(1, { duration: SPIN_MS, easing: Easing.linear }), -1, false);
  }, [turn]);

  const spin = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value * 360}deg` }] }));

  return (
    <Animated.View style={[styles.ring, spin]}>
      <Svg width={RING_SIZE} height={RING_SIZE}>
        <Circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          stroke={color}
          strokeWidth={RING_STROKE}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${RING_CIRCUMFERENCE * ARC} ${RING_CIRCUMFERENCE}`}
        />
      </Svg>
    </Animated.View>
  );
}

/**
 * Shown from the moment a turn is sent until the first token lands.
 *
 * Unmounted by the row above as soon as there is text, so nothing here has to
 * coordinate with the reveal: it runs for exactly as long as there is nothing to
 * show.
 *
 * `label` overrides the cycling words with something known. While it is set the
 * cycle stops rather than continuing underneath: a real description replaced two
 * seconds later by "Almost there" would read as the search having finished, which is
 * the opposite of what a still-open tool call means.
 */
export function ThinkingIndicator({ label }: { label?: string } = {}) {
  const { colors } = useTheme();
  const [index, setIndex] = useState(0);

  /*
   * Opacity and offset are separate values because the swap is not symmetric: the
   * outgoing word leaves upwards and the next one arrives from below, so the offset
   * has to jump across zero while the word is invisible. One value driving both
   * would slide the new word down from where the old one went.
   */
  const fade = useSharedValue(1);
  const slide = useSharedValue(0);
  const pulse = useSharedValue(1);

  // Timers, kept in a ref so the cleanup can clear whichever one is outstanding.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(PULSE_FLOOR, { duration: PULSE_MS, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [pulse]);

  useEffect(() => {
    /*
     * The cycle is driven by timeouts rather than by animation callbacks. A callback
     * on the fade would have to hop back to JS to advance the word, and a swap that
     * is skipped -- a dropped frame, the screen going away mid-turn -- would leave the
     * word stuck. Timers keep the schedule independent of whether any one animation
     * finished.
     */
    const step = (from: number) => {
      const next = from + 1;
      fade.value = withTiming(0, { duration: OUT_MS, easing: EASE_IN });
      slide.value = withTiming(-RISE, { duration: OUT_MS, easing: EASE_IN });

      timer.current = setTimeout(() => {
        setIndex(next);
        // Placed below without animating, so the incoming word rises into place.
        slide.value = RISE;
        fade.value = withTiming(1, { duration: IN_MS, easing: EASE_OUT });
        slide.value = withTiming(0, { duration: IN_MS, easing: EASE_OUT });
        /*
         * The list runs out rather than looping. Going from "Almost there" back to
         * "Thinking" would read as the request having restarted, which is the one
         * thing it has not done -- so the last word holds, and the ring and the
         * breathe under it are what carry on saying this is still alive.
         */
        if (next < WORDS.length - 1) timer.current = setTimeout(() => step(next), HOLD_MS);
      }, OUT_MS);
    };

    if (label) {
      /*
       * A label arriving mid-swap would otherwise be stranded at whatever opacity the
       * outgoing word was left at, so the fade is put back before bailing out.
       */
      fade.value = withTiming(1, { duration: IN_MS, easing: EASE_OUT });
      slide.value = withTiming(0, { duration: IN_MS, easing: EASE_OUT });
      return;
    }

    timer.current = setTimeout(() => step(0), HOLD_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [fade, label, slide]);

  const word = useAnimatedStyle(() => ({
    opacity: fade.value * pulse.value,
    transform: [{ translateY: slide.value }],
  }));

  const ring = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <View
      style={styles.row}
      accessibilityRole="progressbar"
      // The label is fixed while the words are not: a live region announcing a new
      // synonym every two seconds would talk over the reply it is waiting for.
      accessibilityLabel={label ?? 'Generating a reply'}
    >
      <Animated.View style={ring}>
        <Spinner color={colors.labelSecondary} />
      </Animated.View>
      {/* Clipped, so a word on its way out disappears at the edge of the row rather
          than overlapping the turn above it. */}
      <View style={styles.viewport}>
        <Animated.View style={word}>
          <AppText variant="thinking" tone="secondary" numberOfLines={1}>
            {label ?? WORDS[index]}
          </AppText>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ring: { width: RING_SIZE, height: RING_SIZE },
  // Tall enough for one line of `type.thinking` and no taller, so the clip is tight.
  viewport: { height: 22, justifyContent: 'center', overflow: 'hidden', flexShrink: 1 },
});
