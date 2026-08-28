import React, { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from './AppText';
import { useTheme } from '../theme/ThemeProvider';
import { layout, type as typeTokens } from '../theme/tokens';

/**
 * Find in chat: the search field that drops under the nav bar.
 *
 * Its own strip rather than something in the bar, because it needs a field, a count
 * and two chevrons -- five controls in a row that already holds three. Dropping in
 * under the bar also means the bar keeps working: the drawer, compose and the menu
 * are all still reachable while a search is open.
 *
 * Purely a control. The screen owns the query, the matches and where the transcript
 * is scrolled to, so this component never sees a message.
 */

/** How tall the strip is, so the screen can pad the transcript out from under it. */
export const FIND_BAR_HEIGHT = 52;

const OPEN_DURATION = 200;
const CLOSE_DURATION = 160;
const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1);
const EASE_IN = Easing.bezier(0.4, 0, 1, 1);

type Props = {
  visible: boolean;
  query: string;
  onChangeQuery: (query: string) => void;
  /** Which hit the chevrons are on, 1-based, and how many there are. */
  index: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
};

/** One chevron. Dimmed and inert when there is nothing to step through. */
function Step({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: 'chevron-up' | 'chevron-down';
  label: string;
  onPress: () => void;
  disabled: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      style={({ pressed }) => [styles.step, { opacity: disabled ? 0.3 : pressed ? 0.5 : 1 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
    >
      <Feather name={icon} size={20} color={colors.labelPrimary} />
    </Pressable>
  );
}

export function FindBar({
  visible,
  query,
  onChangeQuery,
  index,
  total,
  onPrev,
  onNext,
  onClose,
}: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput | null>(null);

  const progress = useSharedValue(visible ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(visible ? 1 : 0, {
      duration: visible ? OPEN_DURATION : CLOSE_DURATION,
      easing: visible ? EASE_OUT : EASE_IN,
    });
    // Focused from here rather than by `autoFocus`, which fires on mount -- the strip
    // stays mounted between searches, so the second open would raise no keyboard.
    if (visible) inputRef.current?.focus();
  }, [progress, visible]);

  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    // Slides out of the bar above it rather than fading in place, so it reads as
    // having come from the button that opened it.
    transform: [{ translateY: (progress.value - 1) * 10 }],
  }));

  /*
   * Kept mounted while hidden, and only made unreachable: the field holds the query
   * the screen is still highlighting on the way out, and unmounting it would also
   * drop the keyboard a frame before the strip finished leaving.
   */
  return (
    <Animated.View
      style={[
        styles.root,
        {
          top: insets.top + layout.chatNavBarHeight,
          height: FIND_BAR_HEIGHT,
          backgroundColor: colors.bgPrimary,
          borderBottomColor: colors.separatorNonOpaque,
        },
        style,
      ]}
      pointerEvents={visible ? 'auto' : 'none'}
    >
      <View style={[styles.field, { backgroundColor: colors.fillQuaternary }]}>
        <Feather name="search" size={16} color={colors.labelTertiary} />
        <TextInput
          ref={inputRef}
          value={query}
          onChangeText={onChangeQuery}
          placeholder="Find in chat"
          placeholderTextColor={colors.labelTertiary}
          style={[typeTokens.bodyRegular, styles.input, { color: colors.labelPrimary }]}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          // Enter walks to the next hit, which is what it does in every other
          // find bar and saves reaching for a chevron between reads.
          onSubmitEditing={onNext}
          accessibilityLabel="Find in chat"
        />
        {/*
         * The count sits inside the field, where a search field's count belongs, and
         * says "no results" as 0/0 rather than disappearing -- a blank field edge
         * looks like the search has not run yet.
         */}
        {query.trim().length > 0 ? (
          <AppText variant="footnote" tone="secondary">
            {total > 0 ? `${index + 1}/${total}` : '0/0'}
          </AppText>
        ) : null}
      </View>

      <Step icon="chevron-up" label="Previous match" onPress={onPrev} disabled={total === 0} />
      <Step icon="chevron-down" label="Next match" onPress={onNext} disabled={total === 0} />

      <Pressable
        onPress={onClose}
        hitSlop={8}
        style={({ pressed }) => [styles.done, { opacity: pressed ? 0.5 : 1 }]}
        accessibilityRole="button"
        accessibilityLabel="Close find"
      >
        <AppText variant="bodyRegular">Done</AppText>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: layout.chatPadding,
    // A hairline rather than a shadow: the transcript is padded out from under this,
    // so the line is separating two surfaces of the same colour, not floating over one.
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  field: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 36,
  },
  // Zeroed for the same reason ModelSheet's is: the row sets the height, and
  // Android's own field padding would push the text off that centre line.
  input: { flex: 1, paddingVertical: 0 },
  step: { width: 30, alignItems: 'center', justifyContent: 'center' },
  done: { paddingLeft: 2 },
});
