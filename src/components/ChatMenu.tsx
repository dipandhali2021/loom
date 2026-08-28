import React, { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from './AppText';
import { useTheme } from '../theme/ThemeProvider';
import { layout, palette } from '../theme/tokens';

/**
 * The chat overflow menu, opened by the nav bar's three dots.
 *
 * A popover anchored under the button rather than a bottom sheet, which is the one
 * shape decision here that is not arbitrary: every item acts on *this* conversation,
 * and a card hanging off the control that opened it says which one. A sheet rising
 * from the far edge of the screen would not -- the app already spends that shape on
 * the model list and the attachment panel, both of which act on the next message.
 *
 * Presentation only. The screen owns what the items do, so the menu never needs to
 * know that a chat can be pinned or what deleting one costs.
 */

export type ChatMenuItem = {
  label: string;
  /** Drawn at the trailing edge, iOS-menu order: what it does, then the glyph. */
  glyph: React.ReactNode;
  onPress: () => void;
  /**
   * Draws the label in red. Only for the one row that destroys something, so the
   * colour stays a warning rather than a decoration.
   */
  destructive?: boolean;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  items: ChatMenuItem[];
};

const OPEN_DURATION = 170;
const CLOSE_DURATION = 130;
const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1);
const EASE_IN = Easing.bezier(0.4, 0, 1, 1);

/** How small the card starts, so it grows out of the button instead of appearing. */
const ENTER_SCALE = 0.92;

/**
 * Wide enough for "Find in chat" plus its glyph and no wider. A menu sized to the
 * screen would read as a panel; this reads as a list of four things.
 */
const CARD_WIDTH = 232;

/** Scrim under a popover, lighter than a sheet's -- the page behind stays legible. */
const SCRIM_OPACITY = 0.25;

export function ChatMenu({ visible, onClose, items }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  // Outlives `visible` so the card has something to shrink back into.
  const [mounted, setMounted] = useState(visible);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      progress.value = withTiming(1, { duration: OPEN_DURATION, easing: EASE_OUT });
    } else {
      progress.value = withTiming(0, { duration: CLOSE_DURATION, easing: EASE_IN }, (finished) => {
        if (finished) runOnJS(setMounted)(false);
      });
    }
  }, [visible, progress]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: ENTER_SCALE + (1 - ENTER_SCALE) * progress.value }],
  }));

  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value * SCRIM_OPACITY }));

  const requestClose = useCallback(() => onClose(), [onClose]);

  if (!mounted) return null;

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={requestClose}
    >
      <View style={styles.root}>
        <Animated.View style={[styles.scrimLayer, scrimStyle]}>
          <View style={styles.scrim} />
        </Animated.View>

        {/* The whole screen closes the menu, which is what a tap outside a popover
            means everywhere else. Under the card, so a row still takes its own tap. */}
        <Pressable
          style={styles.dismiss}
          onPress={requestClose}
          accessibilityRole="button"
          accessibilityLabel="Close menu"
        />

        <Animated.View
          style={[
            styles.card,
            {
              // Under the bar and in from the same edge the button sits on, so the
              // card's corner lines up with the control that opened it.
              top: insets.top + layout.chatNavBarHeight - 2,
              backgroundColor: colors.groupedCard,
              borderColor: colors.separatorNonOpaque,
            },
            cardStyle,
          ]}
        >
          {items.map((item, index) => (
            <Pressable
              key={item.label}
              onPress={() => {
                /*
                 * Closed before the action runs. Every item either navigates, opens
                 * something else, or takes the conversation away -- so a menu still
                 * standing over the result is the wrong thing in all four cases.
                 */
                requestClose();
                item.onPress();
              }}
              style={({ pressed }) => [
                styles.row,
                index > 0 ? styles.rowDivided : null,
                index > 0 ? { borderTopColor: colors.separatorNonOpaque } : null,
                { backgroundColor: pressed ? colors.rowActive : 'transparent' },
              ]}
              accessibilityRole="button"
              accessibilityLabel={item.label}
            >
              <AppText
                variant="bodyRegular"
                tone={item.destructive ? 'none' : 'primary'}
                numberOfLines={1}
                style={[styles.label, item.destructive ? { color: palette.danger } : null]}
              >
                {item.label}
              </AppText>
              {item.glyph}
            </Pressable>
          ))}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scrimLayer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  scrim: { flex: 1, backgroundColor: palette.black },
  dismiss: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  /*
   * The hairline and the shadow are both needed rather than one or the other: in
   * dark mode the card is a grey step off black and the border is what draws its
   * edge, in light mode it is white on white and only the shadow separates them.
   */
  card: {
    position: 'absolute',
    right: layout.chatPadding,
    width: CARD_WIDTH,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    shadowColor: palette.black,
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    height: 46,
    paddingHorizontal: 14,
  },
  rowDivided: { borderTopWidth: StyleSheet.hairlineWidth },
  // Takes the slack, so every glyph lands on the same trailing edge.
  label: { flex: 1 },
});
