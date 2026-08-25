import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, IconName } from '../../src/components/Icon';
import { AppText } from '../../src/components/AppText';
import { useTheme } from '../../src/theme/ThemeProvider';
import { layout, palette, type } from '../../src/theme/tokens';

/**
 * The four feature items, in the order the design stacks them
 * (Figma 11:608 / 11:626 / 11:614 / 11:620 at y = 167 / 251 / 336 / 421).
 */
const ITEMS: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'recording-01',
    title: 'Just start talking',
    body: 'Now you can have spoken conversations with ChatGPT.',
  },
  {
    icon: 'headphones-01',
    title: 'Hands-free',
    body: 'Chat without having to look at your your screen.',
  },
  {
    icon: 'message-check',
    title: 'Chats are saved',
    body: 'View voice transcriptions in your history. Audio clips aren’t stored.',
  },
  {
    icon: 'flag-06',
    title: 'Language is auto-detected',
    body: 'You can specify a preferred language in Settings for a more accurate detection.',
  },
];

/** Voice Chat > Welcome (Figma 11:603). */
export default function VoiceWelcomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  return (
    <View style={[styles.screen, { backgroundColor: colors.bgPrimary, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <AppText tone="primary" style={type.voiceTitle}>
          Chat with voice
        </AppText>
        {/* The Figma frame has no dismiss control; a full-screen modal needs one,
            so this reuses the Close treatment from the Choose-a-voice frame. */}
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={[styles.close, { backgroundColor: colors.fillPrimary }]}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <Icon name="xmark" size={24} color={colors.labelSecondary} />
        </Pressable>
      </View>

      <View style={styles.items}>
        {ITEMS.map((item) => (
          <View key={item.title} style={styles.item}>
            <Icon name={item.icon} size={24} color={colors.labelPrimary} />
            <View style={styles.itemText}>
              <AppText tone="primary" style={type.itemTitle}>
                {item.title}
              </AppText>
              <AppText tone="secondary" style={type.itemBody}>
                {item.body}
              </AppText>
            </View>
          </View>
        ))}
      </View>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 18) + 34 }]}>
        <Pressable
          onPress={() => router.push('/voice/choose?from=welcome')}
          style={({ pressed }) => [styles.cta, { opacity: pressed ? 0.85 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel="Choose a voice"
        >
          <AppText tone="none" style={[type.authButton, styles.ctaLabel]}>
            Choose a voice
          </AppText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  // Title baseline sits 36pt under the status bar (design y = 95, status bar = 59).
  header: { paddingHorizontal: 25, paddingTop: 36 },
  close: { position: 'absolute', right: 20, top: 45, width: 24, height: 24, borderRadius: 1000, alignItems: 'center', justifyContent: 'center' },
  // First item at design y = 167, i.e. 31pt below the 41pt-tall title.
  items: { paddingLeft: 35, paddingRight: 25, paddingTop: 31, gap: 16, flex: 1 },
  item: { flexDirection: 'row', gap: 25, alignItems: 'flex-start' },
  itemText: { flex: 1, gap: 2 },
  footer: { paddingHorizontal: 25 },
  cta: {
    height: 56,
    borderRadius: layout.buttonRadius,
    backgroundColor: palette.voiceBlue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaLabel: { color: palette.white, letterSpacing: 0 },
});
