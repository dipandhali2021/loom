import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from './Icon';
import { AppText } from './AppText';
import { useTheme } from '../theme/ThemeProvider';
import { layout, type } from '../theme/tokens';

/**
 * The frame the three reference screens share: Help Center, Terms of Use and
 * Privacy Policy.
 *
 * One component rather than three copies of the same nav bar and scroll view. They
 * are the screens most likely to be edited by someone who is not looking at the
 * code -- a policy changes, a support address moves -- so the layout is worth
 * having in exactly one place, leaving each screen as prose and nothing else.
 */

type Props = {
  title: string;
  /** Rendered under the title, before the body. A revision date on a policy. */
  subtitle?: string;
  children: React.ReactNode;
};

export function DocScreen({ title, subtitle, children }: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  return (
    <View style={[styles.screen, { backgroundColor: colors.bgPrimary, paddingTop: insets.top }]}>
      <View style={styles.navBar}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <Icon name="chevron-left" size={24} color={colors.labelPrimary} />
        </Pressable>
        {/* The title is in the body too, at reading size. Up here it is the
            breadcrumb for someone who has scrolled past it. */}
        <AppText variant="bodySemibold">{title}</AppText>
        <View style={styles.spacer} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 20) + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heading}>
          <AppText variant="largeTitle">{title}</AppText>
          {subtitle ? (
            <AppText variant="footnote" tone="secondary">
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {children}
      </ScrollView>
    </View>
  );
}

/** A titled block of prose. The unit every one of these screens is built from. */
export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <AppText tone="primary" style={type.title3Bold}>
        {title}
      </AppText>
      {children}
    </View>
  );
}

/** One paragraph, at the reading measure the rest of the app uses for long text. */
export function Prose({ children }: { children: React.ReactNode }) {
  return (
    <AppText tone="primary" style={type.message}>
      {children}
    </AppText>
  );
}

/**
 * A bulleted list.
 *
 * The bullet is a fixed-width column rather than a character in the string, so a
 * line that wraps aligns under its own text instead of under the dot.
 */
export function Bullets({ items }: { items: string[] }) {
  return (
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
  content: { paddingHorizontal: 16, paddingTop: 16, gap: 32 },
  heading: { gap: 4 },
  section: { gap: 8 },
  bulletRow: { flexDirection: 'row' },
  bullet: { width: 25.5, textAlign: 'center' },
  bulletText: { flex: 1 },
});
