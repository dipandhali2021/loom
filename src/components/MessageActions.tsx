import React, { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, Share, StyleSheet, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import { Icon } from './Icon';
import { useTheme } from '../theme/ThemeProvider';
import { useChatStore } from '../store/ChatStore';

const HIT = 8;
const GLYPH = 19;

type Props = {
  /** The assistant turn these actions belong to. */
  messageId: string;
  text: string;
};

/**
 * The action row under a finished assistant reply: copy, read aloud, the two
 * votes, regenerate, share.
 *
 * Glyphs come from the committed Figma exports where the kit's icon exists in
 * `assets/icons/` (speaker, regenerate); the rest use Feather from
 * `@expo/vector-icons`, whose outlines match the kit's 1.6pt stroke. Nothing here
 * is hand-drawn.
 */
export function MessageActions({ messageId, text }: Props) {
  const { colors } = useTheme();
  const { regenerate, hapticsEnabled } = useChatStore();
  const [copied, setCopied] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [vote, setVote] = useState<'up' | 'down' | null>(null);

  // A tap can leave speech running; stop it when the turn unmounts.
  useEffect(() => () => { Speech.stop().catch(() => {}); }, []);

  const tap = useCallback(() => {
    if (hapticsEnabled && Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
  }, [hapticsEnabled]);

  const copy = async () => {
    tap();
    await Clipboard.setStringAsync(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  const speak = async () => {
    tap();
    if (speaking) {
      setSpeaking(false);
      await Speech.stop().catch(() => {});
      return;
    }
    setSpeaking(true);
    Speech.speak(text, {
      onDone: () => setSpeaking(false),
      onStopped: () => setSpeaking(false),
      onError: () => setSpeaking(false),
    });
  };

  const share = async () => {
    tap();
    await Share.share({ message: text }).catch(() => {});
  };

  const setVoteTo = (next: 'up' | 'down') => {
    tap();
    setVote((prev) => (prev === next ? null : next));
  };

  const dim = colors.labelSecondary;
  const on = colors.labelPrimary;

  return (
    <View style={styles.row}>
      <Pressable onPress={copy} hitSlop={HIT} accessibilityRole="button" accessibilityLabel={copied ? 'Copied' : 'Copy'}>
        <Feather name={copied ? 'check' : 'copy'} size={GLYPH} color={copied ? on : dim} />
      </Pressable>

      <Pressable
        onPress={speak}
        hitSlop={HIT}
        accessibilityRole="button"
        accessibilityLabel={speaking ? 'Stop reading aloud' : 'Read aloud'}
      >
        <Icon name="volume-max" size={GLYPH} color={speaking ? on : dim} />
      </Pressable>

      <Pressable
        onPress={() => setVoteTo('up')}
        hitSlop={HIT}
        accessibilityRole="button"
        accessibilityLabel="Good response"
        accessibilityState={{ selected: vote === 'up' }}
      >
        <Feather name="thumbs-up" size={GLYPH} color={vote === 'up' ? on : dim} />
      </Pressable>

      <Pressable
        onPress={() => setVoteTo('down')}
        hitSlop={HIT}
        accessibilityRole="button"
        accessibilityLabel="Bad response"
        accessibilityState={{ selected: vote === 'down' }}
      >
        <Feather name="thumbs-down" size={GLYPH} color={vote === 'down' ? on : dim} />
      </Pressable>

      <Pressable
        onPress={() => { tap(); regenerate(messageId); }}
        hitSlop={HIT}
        accessibilityRole="button"
        accessibilityLabel="Regenerate response"
      >
        <Icon name="refresh-cw" size={GLYPH} color={dim} />
      </Pressable>

      <Pressable onPress={share} hitSlop={HIT} accessibilityRole="button" accessibilityLabel="Share response">
        <Feather name="share" size={GLYPH} color={dim} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  // 22pt between glyphs matches the kit's row; 6pt of air separates it from the text above.
  row: { flexDirection: 'row', alignItems: 'center', gap: 22, paddingTop: 6 },
});
