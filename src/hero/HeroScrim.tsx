import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { palette } from '../theme/tokens';

/**
 * How much of the video the flat black layer eats, everywhere.
 *
 * Low on purpose. The clips are the only motion on this screen, and a dim heavy
 * enough to protect type across the whole frame also flattens them into a
 * texture -- you can tell something is moving without being able to tell what.
 * So this only takes the edge off the highlights, and the two ramps below do the
 * actual protecting, over the bands where the words are rather than over the
 * footage as a whole.
 */
const DIM = 0.26;

/**
 * The bottom ramp: what the sheet is grounded on. Black at the floor, so the
 * sheet's rounded top has something to sit against, and gone by a little over
 * half way up -- past that there is nothing to protect, so it is left as video.
 */
const FLOOR = { span: 0.56, max: 1 };

/**
 * The top ramp: what the wordmark is read against. Much lighter, and reaching
 * far enough down to cover the wordmark's band at `WORD_TOP_RATIO` (~33%)
 * including the height it gains when it is pushed up by the keyboard.
 */
const CEILING = { span: 0.56, max: 0.46 };

/**
 * A smoothstep, sampled: the same shape `TopFade` uses, for the same reason -- a
 * straight two-stop ramp bands visibly on a dark screen and its midpoint reads as
 * a hard edge, so both ends get eased.
 *
 * `t` runs from the ramp's dark end toward its clear one, and `span` is how far
 * across the frame it gets before it is fully gone; the remainder is pinned at
 * zero so the middle of the screen is untouched video.
 */
function ramp({ span, max }: { span: number; max: number }) {
  const stops = [0, 0.14, 0.28, 0.42, 0.56, 0.7, 0.85, 1].map((t) => ({
    offset: t * span,
    opacity: max * (1 - t * t * (3 - 2 * t)),
  }));
  return span < 1 ? [...stops, { offset: 1, opacity: 0 }] : stops;
}

const FLOOR_STOPS = ramp(FLOOR);
const CEILING_STOPS = ramp(CEILING);

/**
 * The layers that sit between the video and the sheet: a light flat dim, then two
 * eased ramps -- one up from the bottom under the sheet, one down from the top
 * under the wordmark -- leaving the middle of the frame as close to the footage
 * as the type allows.
 *
 * `react-native-svg` rather than `expo-linear-gradient` -- svg is already a
 * dependency and already draws every gradient in the app, so this needs no new
 * native module to get the same result.
 */
export function HeroScrim() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[StyleSheet.absoluteFill, styles.dim]} />
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          {/* Vertical: `x1 === x2`. y1 is the bottom, so this ramp runs upward. */}
          <LinearGradient id="heroScrimFloor" x1="0" y1="1" x2="0" y2="0">
            {FLOOR_STOPS.map((stop) => (
              <Stop
                key={stop.offset}
                offset={stop.offset}
                stopColor={palette.black}
                stopOpacity={stop.opacity}
              />
            ))}
          </LinearGradient>
          {/* And this one downward, from the top edge. */}
          <LinearGradient id="heroScrimCeiling" x1="0" y1="0" x2="0" y2="1">
            {CEILING_STOPS.map((stop) => (
              <Stop
                key={stop.offset}
                offset={stop.offset}
                stopColor={palette.black}
                stopOpacity={stop.opacity}
              />
            ))}
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#heroScrimCeiling)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#heroScrimFloor)" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  dim: { backgroundColor: palette.black, opacity: DIM },
});
