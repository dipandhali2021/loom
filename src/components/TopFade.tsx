import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { layout } from '../theme/tokens';

/**
 * How far past the nav bar the fade keeps going. The bar itself is only the top
 * of the ramp: the transcript has to be gone before it reaches the bar, or a line
 * of text would appear to run into the icons.
 */
const TAIL = 34;

/**
 * Stops of a smoothstep, sampled. A straight two-stop ramp bands visibly on a
 * dark screen and its midpoint reads as a hard edge; easing the ends is what
 * makes the text look like it dissolves rather than passing under a panel.
 */
const STOPS = [0, 0.18, 0.34, 0.5, 0.64, 0.78, 0.9, 1].map((t) => ({
  offset: t,
  // 1 at the top, 0 at the bottom, eased at both ends.
  opacity: 1 - t * t * (3 - 2 * t),
}));

/**
 * The gradient the transcript scrolls up into, so the chat runs full-screen under
 * a nav bar with no background of its own.
 *
 * A gradient rather than a `BlurView`: blurring a dark page renders it grey, which
 * is why the bar was opaque before. This instead paints the page's own colour at
 * full strength behind the bar and lets it fall off to nothing below, so what the
 * eye sees is the text dissolving into the background rather than a panel edge.
 */
export function TopFade() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const height = insets.top + layout.chatNavBarHeight + TAIL;

  const stops = useMemo(
    () =>
      STOPS.map((stop) => (
        <Stop
          key={stop.offset}
          offset={stop.offset}
          stopColor={colors.bgPrimary}
          stopOpacity={stop.opacity}
        />
      )),
    [colors.bgPrimary],
  );

  return (
    <View style={[styles.fill, { height }]} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          {/* Vertical: `x1 === x2`, top to bottom in the gradient's own box. */}
          <LinearGradient id="topFade" x1="0" y1="0" x2="0" y2="1">
            {stops}
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#topFade)" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0, right: 0 },
});
