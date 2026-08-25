import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../src/components/Icon';
import { AppText } from '../src/components/AppText';
import { useTheme } from '../src/theme/ThemeProvider';
import { layout, type } from '../src/theme/tokens';

const CAN_DO = [
  'Get Inspired: Use for your own projects.',
  'Save Time: Use as a starting point.',
  'Customize: Modify for your needs.',
];

const CANNOT_DO = ['Commercial Use: For personal and educational use only.', 'Resell: Do not resell or redistribute.'];

/** About (Figma 26:652). */
export default function AboutScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  return (
    <View style={[styles.screen, { backgroundColor: colors.bgPrimary, paddingTop: insets.top }]}>
      <View style={styles.navBar}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <Icon name="chevron-left" size={24} color={colors.labelPrimary} />
        </Pressable>
        <AppText variant="bodySemibold">About</AppText>
        <View style={styles.spacer} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 20) + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <AppText tone="primary" style={type.message}>
          Recreated the ChatGPT iOS app UI in Figma to help you learn and get inspired.
        </AppText>

        <ListBlock title="What you can do:" items={CAN_DO} />
        <ListBlock title="What you can’t do:" items={CANNOT_DO} />
      </ScrollView>
    </View>
  );
}

function ListBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <View style={styles.block}>
      <AppText tone="primary" style={type.title3Bold}>
        {title}
      </AppText>
      <View>
        {items.map((item) => (
          <View key={item} style={styles.bulletRow}>
            <AppText tone="primary" style={[type.message, styles.bullet]}>
              •
            </AppText>
            <AppText tone="primary" style={[type.message, styles.bulletText]}>
              {item}
            </AppText>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  navBar: {
    height: layout.navBarHeight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  spacer: { width: 24 },
  content: { paddingHorizontal: 16, paddingTop: 24, gap: 32 },
  block: { gap: 8 },
  // Design indents list items 25.5pt from the text column.
  bulletRow: { flexDirection: 'row' },
  bullet: { width: 25.5, textAlign: 'center' },
  bulletText: { flex: 1 },
});
