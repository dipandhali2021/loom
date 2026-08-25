import React from 'react';
import { Image, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../src/components/Icon';
import { AppText } from '../src/components/AppText';
import { useTheme } from '../src/theme/ThemeProvider';
import { palette, type } from '../src/theme/tokens';

const BMC_URL = 'https://buymeacoffee.com/iosipratama';
const DOGE_ADDRESS = 'D92Y5QvroPK4NCsHvHG5eQxnrGcDPy8wQD';
const SOCIALS = [
  { label: 'posts.CV - @iosipratama', url: 'https://posts.cv/iosipratama' },
  { label: 'x / previously Twitter - @iosipratama', url: 'https://x.com/iosipratama' },
];

/** Support (Figma 37:666), reached from Settings > Help Center. */
export default function SupportScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  return (
    <View style={[styles.screen, { backgroundColor: colors.bgPrimary }]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 20) + 32 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Banner is 411pt wide on a 393pt frame — it bleeds past both edges. */}
        <View style={[styles.banner, { height: 138 + insets.top }]} />

        {/* The frame has no nav bar; a pushed screen needs a way back. */}
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={[styles.back, { top: insets.top + 10 }]}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Icon name="chevron-left" size={24} color={palette.black} />
        </Pressable>

        <Image
          source={require('../assets/img/profile.png')}
          style={[styles.profile, { top: insets.top + 80 }]}
          accessibilityIgnoresInvertColors
        />

        <View style={styles.content}>
          <Section title="About Me">
            <AppText tone="primary" style={type.message}>
              Hi, I&apos;m Iosi, an iOS app designer. I create resources to help you design better apps. If you find my
              work useful, please support me to keep making more.
            </AppText>
          </Section>

          <View style={styles.support}>
            <AppText tone="primary" style={type.title3Bold}>
              Support
            </AppText>

            <Pressable
              onPress={() => Linking.openURL(BMC_URL)}
              style={({ pressed }) => [styles.donateRow, { opacity: pressed ? 0.6 : 1 }]}
              accessibilityRole="link"
              accessibilityLabel="Buy Me A Coffee"
            >
              <View style={styles.bmcBadge}>
                <Image source={require('../assets/img/bmc.png')} style={styles.bmcImage} accessibilityIgnoresInvertColors />
              </View>
              <View style={styles.donateText}>
                <AppText tone="primary" style={type.title3Semibold}>
                  Buy Me A Coffee
                </AppText>
                <AppText tone="primary" style={[type.mono, styles.link]}>
                  buymeacoffee.com/iosipratama
                </AppText>
              </View>
            </Pressable>

            <View style={styles.donateRow}>
              <Icon name="doge" size={60} />
              <View style={styles.donateText}>
                <AppText tone="primary" style={type.title3Semibold}>
                  Doge Coin
                </AppText>
                <AppText tone="primary" style={[type.mono, styles.address]} selectable>
                  {DOGE_ADDRESS}
                </AppText>
              </View>
            </View>
          </View>

          <Section title="Social Media">
            {SOCIALS.map((social) => (
              <Pressable
                key={social.url}
                onPress={() => Linking.openURL(social.url)}
                accessibilityRole="link"
                accessibilityLabel={social.label}
              >
                <AppText tone="primary" style={[type.message, styles.link]}>
                  {social.label}
                </AppText>
              </Pressable>
            ))}
          </Section>
        </View>
      </ScrollView>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <AppText tone="primary" style={type.title3Bold}>
        {title}
      </AppText>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  banner: { backgroundColor: palette.supportBanner, marginHorizontal: -9 },
  back: { position: 'absolute', left: 16, width: 24, height: 24 },
  profile: { position: 'absolute', left: 16, width: 100, height: 100, borderRadius: 50 },
  content: { paddingHorizontal: 16, paddingTop: 66, gap: 32 },
  section: { gap: 8 },
  support: { gap: 20 },
  donateRow: { flexDirection: 'row', gap: 16, alignItems: 'center' },
  bmcBadge: {
    width: 60,
    height: 60,
    borderRadius: 100,
    backgroundColor: palette.buyMeACoffee,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    // Design: 0 2 8 rgba(0,0,0,0.05).
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    elevation: 2,
  },
  bmcImage: { width: 52, height: 52 },
  donateText: { gap: 2, flexShrink: 1 },
  link: { textDecorationLine: 'underline' },
  address: { letterSpacing: 0.8 },
});
