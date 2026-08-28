import React, { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from './Icon';
import { useTheme } from '../theme/ThemeProvider';
import { layout } from '../theme/tokens';

type Props = {
  onPressMenu?: () => void;
  onPressEdit?: () => void;
  onPressMore?: () => void;
  /**
   * Show the temporary-chat toggle instead of the compose + overflow pair.
   *
   * True while the chat screen is empty: there is nothing to compose away from and
   * nothing for the overflow menu to act on, and the choice that does matter at that
   * moment is whether this chat gets written down.
   */
  showTemporary?: boolean;
  /** Whether temporary mode is on, which is the toggle's glyph. */
  temporary?: boolean;
  onToggleTemporary?: () => void;
};

/** How long the right-hand slot takes to change which control it holds. */
const SWAP_DURATION = 260;
/*
 * The house ease-out, matching HistoryDrawer. The swap is triggered by the first
 * message of a chat appearing, so it plays alongside that row's own fade-in and
 * wants the same deceleration.
 */
const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1);

/** A lone button's circle, and the two-button pill: the two widths the slot takes. */
const CIRCLE_WIDTH = layout.navIconButton;
const PILL_WIDTH = layout.navIconButton * 2;

/** How far the outgoing glyphs shrink as they leave, so a swap reads as a swap. */
const EXIT_SCALE = 0.8;

/**
 * One nav icon's hit target. The grey circle it used to carry now belongs to the
 * `Group` around it -- the bar is transparent, so a filled shape is what keeps
 * the icons legible over transcript text moving underneath, and the compose and
 * overflow pair share one so they read as a single control.
 */
function IconButton({
  onPress,
  label,
  children,
  ...rest
}: {
  onPress?: () => void;
  label: string;
  children: React.ReactNode;
  accessibilityState?: { selected?: boolean };
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.iconButton, { opacity: pressed ? 0.6 : 1 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
      {...rest}
    >
      {children}
    </Pressable>
  );
}

/**
 * The filled capsule the icons sit in. One child gives a circle, two give the pill
 * the design draws around compose + overflow; either way the radius is half the
 * height, so the shape follows from how many buttons it holds.
 */
function Group({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return <View style={[styles.group, { backgroundColor: colors.fillPrimary }]}>{children}</View>;
}

/**
 * The right-hand slot, which holds one of two controls and animates between them.
 *
 * Both sets are mounted the whole time and crossfaded, with the filled capsule
 * around them morphing between a circle and a pill. Swapping them by unmounting
 * would be a cut: the pill would vanish and the circle appear a frame later, with
 * the fill jumping width in between.
 *
 * Everything is anchored to the right edge -- the capsule, and the icon rows inside
 * it -- because that edge is where both shapes end in the design. So the shrink
 * pulls the capsule's *left* edge inward and clips compose out from under it, while
 * the toggle fades up over the overflow button, which is the one thing that does
 * not move.
 */
function TrailingSlot({
  showTemporary,
  temporary,
  onToggleTemporary,
  onPressEdit,
  onPressMore,
}: Required<Pick<Props, 'showTemporary' | 'temporary'>> &
  Pick<Props, 'onToggleTemporary' | 'onPressEdit' | 'onPressMore'>) {
  const { colors } = useTheme();

  /*
   * 1 while the toggle is showing, 0 while the pair is.
   *
   * Seeded from the prop rather than from 0, which is the whole reason this is a
   * shared value driven by an effect instead of a `useDerivedValue` wrapping
   * `withTiming`: that starts every animation from zero, so opening the app on an
   * empty chat would show the pill for a moment and animate it down to the circle.
   * Seeded, the first pass is a no-op -- withTiming to the value already held.
   */
  const progress = useSharedValue(showTemporary ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(showTemporary ? 1 : 0, {
      duration: SWAP_DURATION,
      easing: EASE_OUT,
    });
  }, [progress, showTemporary]);

  const capsule = useAnimatedStyle(() => ({
    width: CIRCLE_WIDTH + (PILL_WIDTH - CIRCLE_WIDTH) * (1 - progress.value),
  }));

  /*
   * Each side fades over the first half of its own direction and holds for the
   * second, so the two are never both at full strength -- overlapping them fully
   * would read as a double exposure rather than a swap.
   */
  const pair = useAnimatedStyle(() => {
    const out = Math.min(1, progress.value * 2);
    return {
      opacity: 1 - out,
      transform: [{ scale: 1 - (1 - EXIT_SCALE) * out }],
    };
  });

  const toggle = useAnimatedStyle(() => {
    const inward = Math.max(0, progress.value * 2 - 1);
    return {
      opacity: inward,
      transform: [{ scale: EXIT_SCALE + (1 - EXIT_SCALE) * inward }],
    };
  });

  return (
    <Animated.View
      style={[styles.capsule, { backgroundColor: colors.fillPrimary }, capsule]}
      /*
       * The hidden set is still mounted, so without this the fully-faded controls
       * would keep taking presses -- and on the empty screen the invisible compose
       * button sits exactly under the visible toggle.
       */
      pointerEvents="box-none"
    >
      <Animated.View
        style={[styles.slotLayer, pair]}
        pointerEvents={showTemporary ? 'none' : 'auto'}
      >
        <IconButton onPress={onPressEdit} label="New chat">
          <Icon name="edit" size={22} color={colors.labelPrimary} />
        </IconButton>
        <IconButton onPress={onPressMore} label="More options">
          <Feather name="more-horizontal" size={22} color={colors.labelPrimary} />
        </IconButton>
      </Animated.View>

      <Animated.View
        style={[styles.slotLayer, toggle]}
        pointerEvents={showTemporary ? 'auto' : 'none'}
      >
        <IconButton
          onPress={onToggleTemporary}
          label={temporary ? 'Turn off temporary chat' : 'Turn on temporary chat'}
          accessibilityState={{ selected: temporary }}
        >
          {/*
           * Two glyphs whose bubble outline is byte-identical, so only the mark
           * inside it appears to change -- the control reads as one button toggling
           * rather than two different icons trading places.
           */}
          <Icon
            name={temporary ? 'temporary-chat-on' : 'temporary-chat'}
            size={23}
            color={temporary ? colors.labelPrimary : colors.labelSecondary}
          />
        </IconButton>
      </Animated.View>
    </Animated.View>
  );
}

/**
 * Chat nav bar: the hamburger on the left, the compose + overflow pair on the
 * right, and nothing between them. The icons are 42pt, which is what pushes the
 * bar to `chatNavBarHeight`'s 50.
 *
 * The wordmark and the model name used to sit beside the hamburger. Both are gone:
 * the model is a property of the message being written, so it moved into the
 * composer's control row, where it is next to the field it applies to and can be
 * changed without crossing the screen. A bar that names the model while stating
 * nothing else about the turn is decoration, and the app's own title is not news
 * to someone already inside it -- so the slot is empty rather than refilled.
 *
 * The bar has no background of its own -- the transcript runs full-screen beneath
 * it and dissolves into `TopFade`'s gradient, which is what the screen composes
 * behind this. Only the icon groups are filled.
 */
export function NavBar({
  onPressMenu,
  onPressEdit,
  onPressMore,
  showTemporary = false,
  temporary = false,
  onToggleTemporary,
}: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.row, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <Group>
          <IconButton onPress={onPressMenu} label="Open chat history">
            <Icon name="menu" size={25} color={colors.labelPrimary} />
          </IconButton>
        </Group>

        <TrailingSlot
          showTemporary={showTemporary}
          temporary={temporary}
          onToggleTemporary={onToggleTemporary}
          onPressEdit={onPressEdit}
          onPressMore={onPressMore}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { width: '100%' },
  bar: {
    height: layout.chatNavBarHeight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: layout.chatPadding,
  },
  // Square, so a lone button's group comes out a circle. The fill lives on the
  // group; this is only the hit target.
  iconButton: {
    width: layout.navIconButton,
    height: layout.navIconButton,
    alignItems: 'center',
    justifyContent: 'center',
  },
  group: {
    flexDirection: 'row',
    alignItems: 'center',
    height: layout.navIconButton,
    // Half the height, so one 42pt child rounds to a circle and two round to a pill.
    borderRadius: layout.navIconButton / 2,
  },
  // The trailing slot's own capsule. Same fill and radius as `group`, but its width
  // is animated, and `hidden` is what clips the wider set as it narrows to a circle.
  capsule: {
    height: layout.navIconButton,
    borderRadius: layout.navIconButton / 2,
    overflow: 'hidden',
  },
  // Both sets stack in the capsule, pinned to its right edge so the shape's growth
  // and shrink happen on the left where nothing is anchored.
  slotLayer: {
    position: 'absolute',
    right: 0,
    top: 0,
    height: layout.navIconButton,
    flexDirection: 'row',
    alignItems: 'center',
  },
});
