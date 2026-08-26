import React from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Icon } from './Icon';
import { useTheme } from '../theme/ThemeProvider';
import { useChatStore } from '../store/ChatStore';
import { layout, type as typeTokens } from '../theme/tokens';

type Props = {
  onSubmit: (text: string) => void;
  onOpenVoice: () => void;
  onStop?: () => void;
  /** Streaming replaces the send affordance with a stop control. */
  isStreaming?: boolean;
  /** Controlled draft text, so a tapped prompt chip can pre-fill the field. */
  value: string;
  onChangeText: (next: string) => void;
  /**
   * Naming the mode in the field itself, the way the app does: "Temporary chat"
   * while one is open, "Ask anything" otherwise. It is the only label on screen once
   * the first turn has scrolled the explanation away, so it is what a user coming
   * back to the app reads to know nothing here is being kept.
   */
  placeholder?: string;
  /** The attachment panel is open, which is what turns the "+" into an "x". */
  sheetOpen?: boolean;
  /** Tapping the leading control. The screen decides which of the two it means. */
  onToggleSheet?: () => void;
  /**
   * The field, so the screen can put the keyboard back when the panel closes.
   * Held there rather than here because the panel is the screen's child: it is
   * laid out below this bar, in the room the keyboard vacated.
   */
  inputRef?: React.RefObject<TextInput | null>;
  /** Tapping into the field. Raising the keyboard is what closes the panel. */
  onFocusField?: () => void;
  /** Web search is armed for the next turn, per the panel's row. */
  webSearch?: boolean;
  /** The chip's own off switch, so turning it off does not need the panel. */
  onDisableWebSearch?: () => void;
};

/**
 * A quarter turn plus a half, so the glyph visibly spins rather than snapping.
 * A plus has four-fold symmetry, so 45deg would already be an "x" -- 135 is the
 * same destination reached the long way round.
 */
const CROSS_ROTATION = 135;
const ROTATE_MS = 240;
const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1);

/**
 * The composer from the ChatGPT Apps UI Kit: one flat pill holding "+",
 * the "Ask anything" field, a mic, and a round trailing button that cycles
 * submit -> stop -> voice depending on state. It no longer expands or collapses
 * — a single layout is what keeps the bar short.
 */
export function Composer({
  onSubmit,
  onOpenVoice,
  onStop,
  isStreaming = false,
  value: text,
  onChangeText: setText,
  placeholder = 'Ask anything',
  sheetOpen = false,
  onToggleSheet,
  inputRef,
  onFocusField,
  webSearch = false,
  onDisableWebSearch,
}: Props) {
  const { colors } = useTheme();
  const { hapticsEnabled } = useChatStore();

  const hasText = text.trim().length > 0;

  /*
   * Driven off the prop rather than off local state: the panel can also be closed
   * by swiping it down, and the glyph has to follow that too.
   */
  const cross = useSharedValue(sheetOpen ? 1 : 0);
  React.useEffect(() => {
    cross.value = withTiming(sheetOpen ? 1 : 0, { duration: ROTATE_MS, easing: EASE_OUT });
  }, [cross, sheetOpen]);

  const crossStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${cross.value * CROSS_ROTATION}deg` }],
  }));

  const tap = () => {
    if (hapticsEnabled && Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
  };

  const submit = () => {
    const value = text.trim();
    if (!value) return;
    tap();
    setText('');
    onSubmit(value);
  };

  // One button, three jobs — the kit draws all three as the same black circle.
  const action = isStreaming
    ? {
        label: 'Stop generating',
        onPress: onStop,
        glyph: <MaterialIcons name="stop" size={20} color={colors.sendGlyph} />,
      }
    : hasText
      ? {
          label: 'Send message',
          onPress: submit,
          glyph: <Feather name="arrow-up" size={20} color={colors.sendGlyph} />,
        }
      : {
          label: 'Voice conversation',
          onPress: onOpenVoice,
          glyph: <MaterialIcons name="graphic-eq" size={20} color={colors.sendGlyph} />,
        };

  return (
    <View style={styles.row}>
      <View style={[styles.pill, { backgroundColor: colors.composerFill }]}>
        <Pressable
          onPress={() => {
            tap();
            onToggleSheet?.();
          }}
          hitSlop={8}
          style={styles.glyph}
          accessibilityRole="button"
          accessibilityLabel={sheetOpen ? 'Close attachments' : 'Add attachment'}
          accessibilityState={{ expanded: sheetOpen }}
        >
          {/* One glyph turned, not two swapped: a plus rotated onto its diagonal
              *is* the cross, so there is nothing to cross-fade and nothing that can
              land half a pixel off its predecessor. */}
          <Animated.View style={crossStyle}>
            <Feather name="plus" size={22} color={colors.labelSecondary} />
          </Animated.View>
        </Pressable>

        {/*
         * The armed state, said in the composer rather than only inside the panel:
         * the panel's row is two taps away once it is closed, and a turn that will
         * search the web should say so where the user is typing it. Tapping the
         * glyph is also how it is turned back off.
         */}
        {webSearch ? (
          <Pressable
            onPress={() => {
              tap();
              onDisableWebSearch?.();
            }}
            hitSlop={6}
            style={[styles.chip, { backgroundColor: colors.fillQuaternary }]}
            accessibilityRole="button"
            accessibilityLabel="Web search on"
            accessibilityHint="Turns web search off"
          >
            <Icon name="globe-01" size={16} color={colors.labelPrimary} />
          </Pressable>
        ) : null}

        <TextInput
          ref={inputRef}
          value={text}
          onChangeText={setText}
          onFocus={onFocusField}
          placeholder={placeholder}
          placeholderTextColor={colors.labelTertiary}
          style={[typeTokens.composer, styles.input, { color: colors.labelPrimary }]}
          multiline
          returnKeyType="default"
          accessibilityLabel={placeholder}
        />

        <Pressable
          onPress={tap}
          hitSlop={8}
          style={styles.glyph}
          accessibilityRole="button"
          accessibilityLabel="Dictate"
        >
          <Feather name="mic" size={20} color={colors.labelSecondary} />
        </Pressable>

        <Pressable
          onPress={action.onPress}
          hitSlop={8}
          style={[styles.send, { backgroundColor: colors.sendButton }]}
          accessibilityRole="button"
          accessibilityLabel={action.label}
        >
          {action.glyph}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: layout.chatPadding },
  pill: {
    flexDirection: 'row',
    // Centred, not bottom-aligned: the field's minHeight is taller than the
    // sibling glyph boxes, so flex-end pushed the placeholder above the "+".
    alignItems: 'center',
    // 6pt of gap plus the glyph boxes' own inset reads as the kit's 12pt.
    gap: 6,
    borderRadius: layout.composerRadius,
    // The glyph boxes centre their icons, so the pill's own inset is reduced by
    // that inset to keep the "+" 14pt from the pill's edge.
    paddingLeft: 8,
    paddingRight: 6,
    paddingVertical: layout.composerPaddingV,
  },
  input: {
    flex: 1,
    // A multiline field grows with its content; min/max bound it to one line and
    // roughly four, which is the range the kit draws.
    minHeight: layout.composerFieldHeight,
    maxHeight: layout.composerMaxHeight,
    // Android draws a multiline TextInput with its own vertical padding; zeroing
    // it and centring the text is what keeps the baseline on the icons' axis.
    paddingTop: 0,
    paddingBottom: 0,
    textAlignVertical: 'center',
    // iOS ignores textAlignVertical, so a one-line field is centred by splitting
    // the difference between the field height and the line box.
    ...Platform.select({
      ios: {
        paddingTop: (layout.composerFieldHeight - typeTokens.composer.lineHeight) / 2,
        paddingBottom: (layout.composerFieldHeight - typeTokens.composer.lineHeight) / 2,
      },
      default: {},
    }),
  },
  // Fixed boxes for the bare glyphs, as tall as a one-line field, so every child
  // shares one centre line no matter how tall the field grows.
  glyph: {
    width: layout.sendButtonSize,
    height: layout.composerFieldHeight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /*
   * The armed-search chip: the globe alone, in a circle.
   *
   * No label. "Search" beside the glyph spent a third of the field's width saying
   * what the glyph already said, and on a narrow phone that is the difference
   * between a placeholder that fits and one that truncates. Kept smaller than the
   * sibling glyph boxes so it reads as a state the composer is in rather than as
   * another button in the row.
   */
  chip: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  send: {
    width: layout.sendButtonSize,
    height: layout.sendButtonSize,
    borderRadius: layout.sendButtonSize / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
