import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Icon } from './Icon';
import { AppText } from './AppText';
import { useTheme } from '../theme/ThemeProvider';
import { layout } from '../theme/tokens';

/**
 * The panel the composer's "+" opens, in the place the keyboard was.
 *
 * Not a Modal, unlike every other overlay in the app. A Modal is its own window
 * above the screen, which is the wrong shape for this: the panel has to occupy
 * exactly the room the keyboard just left, under a composer that must not move
 * while they trade places. Rendered inline under the composer, that comes out of
 * the layout for free -- the keyboard collapsing and this growing are the same
 * number of points, so the type box stays put.
 *
 * Its height is the keyboard's own measured height, passed in by the composer,
 * which is what makes the swap invisible rather than approximately right.
 */

type Props = {
  open: boolean;
  /** Measured keyboard height. The panel is exactly this tall. */
  height: number;
  /**
   * Closing. `restoreKeyboard` distinguishes the two ways out: the "x" and a
   * downward swipe put the keyboard back, because the user is still mid-message;
   * tapping into the field itself is already raising it.
   */
  onClose: (restoreKeyboard: boolean) => void;
  /**
   * How long the collapse should take, in ms, overriding the panel's own curve.
   *
   * Set when the keyboard is taking over these exact points. Two independent
   * animations over the same run of pixels -- this panel's 200ms collapse and the
   * keyboard's rise, which the OS times and does not share -- cannot stay in step,
   * and the gap between them is the composer visibly lifting and settling for
   * about a second. So the screen hands over the keyboard's own duration and the
   * panel shrinks by exactly as much as the keyboard's inset grows.
   *
   * `0` collapses in a single frame, for the case where the keyboard is already up
   * by the time the screen hears about it.
   */
  collapseMs?: number;
  webSearch: boolean;
  onToggleWebSearch: (on: boolean) => void;
  /**
   * Opens the system photo picker. Resolves with a note to show under the row when
   * the pick could not happen -- the per-message cap, most often -- and `null` when
   * it did, including when the user simply backed out of it.
   */
  onPickPhotos: () => Promise<string | null>;
  /** The same, for the document picker. */
  onPickFiles: () => Promise<string | null>;
};

const OPEN_DURATION = 260;
const CLOSE_DURATION = 200;
const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1);
const EASE_IN = Easing.bezier(0.4, 0, 1, 1);

/** How far down a drag must get, as a share of the height, to count as closing. */
const CLOSE_FRACTION = 0.3;
const CLOSE_VELOCITY = 600;

export function AttachmentSheet({
  open,
  height,
  onClose,
  collapseMs,
  webSearch,
  onToggleWebSearch,
  onPickPhotos,
  onPickFiles,
}: Props) {
  const { colors } = useTheme();

  /*
   * Mounted separately from `open` so the collapse has something to animate, the
   * same way HistoryDrawer outlives its `visible`.
   */
  const [mounted, setMounted] = useState(open);
  // 0 = collapsed to nothing, 1 = full keyboard height.
  const progress = useSharedValue(0);

  /*
   * `collapseMs` is a plain dependency rather than a ref read, which is safe
   * because it never changes on its own: every place the screen sets it also sets
   * `open` in the same commit, so this only ever re-runs on a real open or close.
   */
  React.useEffect(() => {
    if (open) {
      setMounted(true);
      progress.value = withTiming(1, { duration: OPEN_DURATION, easing: EASE_OUT });
      return;
    }

    // Android hands over a duration of 0: the window resize is not animated there,
    // so the panel has to disappear in the same commit rather than fade out of one.
    if (collapseMs === 0) {
      progress.value = 0;
      setMounted(false);
      return;
    }

    /*
     * Riding the keyboard: linear, and deliberately so. The keyboard's own easing
     * is applied to the inset by the layout animation, and the panel is subtracting
     * from that same total -- so a second curve on top of it would bend the sum.
     * Straight interpolation is what keeps `panel + inset` constant at every frame
     * rather than only at the two ends.
     */
    const handing = collapseMs !== undefined;
    progress.value = withTiming(
      0,
      {
        duration: handing ? collapseMs : CLOSE_DURATION,
        easing: handing ? Easing.linear : EASE_IN,
      },
      (finished) => {
        if (finished) runOnJS(setMounted)(false);
      },
    );
  }, [collapseMs, open, progress]);

  const requestClose = useCallback(() => onClose(true), [onClose]);

  /**
   * Runs one picker and closes the panel unless it had something to say.
   *
   * `false` for the keyboard: what replaced the panel was the system picker, and
   * raising a keyboard behind it would put the composer back over the transcript for
   * no one to type into.
   */
  const pick = useCallback(
    async (open: () => Promise<string | null>) => {
      const note = await open();
      if (!note) onClose(false);
      return note;
    },
    [onClose],
  );

  /*
   * Swipe down to dismiss. Only downward travel counts -- the panel is already at
   * its full height, so an upward drag has nowhere to go -- and the release either
   * commits or springs back. Horizontal movement fails the gesture so a stray
   * sideways flick over a row does not start collapsing it.
   */
  const pan = Gesture.Pan()
    .activeOffsetY(12)
    .failOffsetX([-24, 24])
    .onUpdate((event) => {
      const dragged = Math.max(0, event.translationY);
      progress.value = Math.max(0, 1 - dragged / height);
    })
    .onEnd((event) => {
      const shouldClose =
        event.translationY > height * CLOSE_FRACTION || event.velocityY > CLOSE_VELOCITY;
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

  /*
   * Height rather than a translate. A panel that slid up from under the composer
   * would have to be absolutely positioned, and then the composer would not know
   * it was there -- the transcript above has to actually shorten by this much, and
   * only a real layout box does that.
   */
  const sheetStyle = useAnimatedStyle(() => ({
    height: progress.value * height,
  }));
  /*
   * The rows fade on a shorter curve than the box, so a half-collapsed panel reads
   * as leaving rather than as three rows being squashed.
   */
  const bodyStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.max(0, progress.value * 1.6 - 0.6)),
  }));

  if (!mounted) return null;

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.sheet, { backgroundColor: colors.groupedCard }, sheetStyle]}>
        <Animated.View style={[styles.body, bodyStyle]}>
          {/* The grabber says the panel can be pulled down, which is the one
              affordance a swipe-to-dismiss surface cannot state in words. */}
          <View style={[styles.grabber, { backgroundColor: colors.separatorOpaque }]} />

          {/*
           * The panel closes once the pick has happened, not before: a refusal (the
           * per-message cap) is reported as this row's own note, and closing first
           * would take the row away with the explanation on it. A pick that went
           * ahead does close it -- the chips it produced sit above the composer, and
           * a panel still standing over them hides what was just attached.
           */}
          <Row icon="image" label="Photos" onPress={() => pick(onPickPhotos)} />
          <Row icon="file-02" label="Files" onPress={() => pick(onPickFiles)} />

          <View style={[styles.divider, { backgroundColor: colors.separatorNonOpaque }]} />

          {/*
           * No switch. The row is the control -- one tap, the way Photos and Files
           * are one tap -- and the state is said by the row filling in and a tick
           * appearing, which is how a selected item reads everywhere else in the
           * app. A switch beside a full-width pressable row that does the same
           * thing is two targets for one setting.
           */}
          <Row
            icon="globe-01"
            label="Web search"
            on={webSearch}
            onPress={() => onToggleWebSearch(!webSearch)}
            note={
              webSearch
                ? 'Replies can look things up and cite what they used'
                : 'Replies answer from what the model already knows'
            }
          />
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

/** One line of the panel: glyph, label, a note under it, and a tick when it is on. */
function Row({
  icon,
  label,
  onPress,
  on,
  note,
  disabledNote,
}: {
  icon: 'image' | 'file-02' | 'globe-01';
  label: string;
  /**
   * The row's action. Resolving with a string shows it as the row's note, which is
   * how a refusal is reported: the app has no alert or toast pattern, and the row
   * the user just pressed is where they are already looking.
   */
  onPress: () => void | Promise<string | null>;
  /**
   * Given only for a row that is a setting rather than an action. `undefined`
   * leaves the row stateless, which is what Photos and Files are -- they open
   * something, so there is nothing for them to be on.
   */
  on?: boolean;
  note?: string;
  /** Shown in place of `note` once pressed, for a row with nothing behind it yet. */
  disabledNote?: string;
}) {
  const { colors } = useTheme();
  const [pressedUnavailable, setPressedUnavailable] = useState(false);
  // What the action itself reported, which outranks both of the static notes.
  const [failure, setFailure] = useState<string | null>(null);

  const subtitle = failure ?? (pressedUnavailable ? disabledNote : note);
  const toggles = on !== undefined;

  return (
    <Pressable
      onPress={() => {
        if (disabledNote) setPressedUnavailable(true);
        setFailure(null);
        const result = onPress();
        if (result) void result.then(setFailure).catch(() => setFailure('That did not work.'));
      }}
      style={({ pressed }) => [
        styles.row,
        {
          // The armed fill stays while the finger is down, so pressing an already-on
          // row does not read as it switching off before the tap has landed.
          backgroundColor: on || pressed ? colors.rowActive : 'transparent',
        },
      ]}
      // Still a switch to a screen reader even without one drawn: the row is a
      // two-state setting, and announcing it as a button loses the state.
      accessibilityRole={toggles ? 'switch' : 'button'}
      accessibilityLabel={label}
      {...(toggles ? { accessibilityState: { checked: on } } : {})}
      {...(subtitle ? { accessibilityHint: subtitle } : {})}
    >
      <Icon name={icon} size={22} color={colors.labelPrimary} />
      <View style={styles.rowText}>
        <AppText variant="bodyRegular" numberOfLines={1}>
          {label}
        </AppText>
        {subtitle ? (
          <AppText variant="footnote" tone="tertiary" numberOfLines={1}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {on ? <Icon name="check" size={18} color={colors.labelPrimary} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  /*
   * Same card colour and same top corners as the sources sheet: they are the two
   * surfaces that rise from the bottom edge, so they are one shape presented twice
   * rather than two panels that happen to slide. The hairline that used to sit on
   * top is gone with the radius -- a straight rule across a rounded corner reads as
   * a seam, and a card that is a distinct grey does not need a line to be separate
   * from the page.
   *
   * `overflow: hidden` is also what lets the animated height crop the rows instead
   * of letting them spill over the composer as the panel closes.
   */
  sheet: {
    overflow: 'hidden',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  body: { paddingTop: 6, paddingHorizontal: 8 },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 8,
    opacity: 0.5,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: 54,
    paddingHorizontal: layout.chatPadding - 8,
    borderRadius: 12,
  },
  rowText: { flex: 1, gap: 1 },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 6,
    marginHorizontal: 8,
  },
});
