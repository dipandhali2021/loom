import React from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as Haptics from 'expo-haptics';
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
};

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
}: Props) {
  const { colors } = useTheme();
  const { hapticsEnabled } = useChatStore();

  const hasText = text.trim().length > 0;

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
    ? { label: 'Stop generating', onPress: onStop, glyph: <MaterialIcons name="stop" size={20} color={colors.sendGlyph} /> }
    : hasText
      ? { label: 'Send message', onPress: submit, glyph: <Feather name="arrow-up" size={20} color={colors.sendGlyph} /> }
      : { label: 'Voice conversation', onPress: onOpenVoice, glyph: <MaterialIcons name="graphic-eq" size={20} color={colors.sendGlyph} /> };

  return (
    <View style={styles.row}>
      <View style={[styles.pill, { backgroundColor: colors.composerFill }]}>
        <Pressable
          onPress={tap}
          hitSlop={8}
          style={styles.glyph}
          accessibilityRole="button"
          accessibilityLabel="Add attachment"
        >
          <Feather name="plus" size={22} color={colors.labelSecondary} />
        </Pressable>

        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Ask anything"
          placeholderTextColor={colors.labelTertiary}
          style={[typeTokens.composer, styles.input, { color: colors.labelPrimary }]}
          multiline
          returnKeyType="default"
          accessibilityLabel="Ask anything"
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
  send: {
    width: layout.sendButtonSize,
    height: layout.sendButtonSize,
    borderRadius: layout.sendButtonSize / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
