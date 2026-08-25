import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../../src/components/Icon';
import { AppText } from '../../src/components/AppText';
import { useChatStore } from '../../src/store/ChatStore';
import { VoiceName } from '../../src/store/types';
import { darkColors, layout, palette, type } from '../../src/theme/tokens';

const VOICES: VoiceName[] = ['Breeze', 'Cove', 'Sky', 'Juniper', 'Ember'];

/** Bar geometry from the design's "Animation Shape" (Figma 11:653). */
const BARS = [
  { height: 76, radius: 34 },
  { height: 79, radius: 34 },
  { height: 106, radius: 36 },
  { height: 76, radius: 34 },
];

/** One of the four white pills, breathing around its design height. */
function Bar({ height, radius, delay }: { height: number; radius: number; delay: number }) {
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 0.82, duration: 900, delay, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [delay, scale]);

  return <Animated.View style={[styles.bar, { height, borderRadius: radius, transform: [{ scaleY: scale }] }]} />;
}

/** Voice Chat > Choose a voice (Figma 13:633). Always dark, like the design. */
export default function ChooseVoiceScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { voice, setVoice } = useChatStore();
  // Reached either from the voice onboarding (confirm starts the call) or from
  // Settings > Voice (confirm just commits the choice).
  const { from } = useLocalSearchParams<{ from?: string }>();
  const startsCall = from === 'welcome';

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <Icon name="volume-max" size={24} color={palette.white} />
        <View style={styles.title}>
          <AppText tone="none" style={[type.title3Regular, styles.titleText]}>
            Choose a voice
          </AppText>
          <AppText tone="none" style={[type.caption1Regular, { color: darkColors.labelSecondary }]}>
            You can change this later.
          </AppText>
        </View>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={[styles.close, { backgroundColor: darkColors.fillPrimary }]}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <Icon name="xmark" size={24} color={palette.white} />
        </Pressable>
      </View>

      <View style={styles.shape}>
        {BARS.map((bar, i) => (
          <Bar key={i} height={bar.height} radius={bar.radius} delay={i * 140} />
        ))}
      </View>

      <View style={styles.options}>
        {VOICES.map((name) => (
          <Pressable
            key={name}
            onPress={() => setVoice(name)}
            style={({ pressed }) => [styles.option, { opacity: pressed ? 0.7 : 1 }]}
            accessibilityRole="radio"
            accessibilityState={{ selected: voice === name }}
            accessibilityLabel={name}
          >
            <AppText tone="none" style={[type.bodyBold, styles.optionLabel]}>
              {name}
            </AppText>
            {voice === name ? <Icon name="check" size={24} color={palette.white} style={styles.optionCheck} /> : null}
          </Pressable>
        ))}
      </View>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 18) + 20 }]}>
        <Pressable
          onPress={() => (startsCall ? router.replace('/voice/talking') : router.back())}
          style={({ pressed }) => [styles.confirm, { opacity: pressed ? 0.85 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel={`Confirm ${voice}`}
        >
          <AppText tone="none" style={[type.bodyBold, { color: palette.black }]}>
            Confirm
          </AppText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.black },
  topBar: { height: 44, justifyContent: 'center', paddingHorizontal: 20 },
  title: { position: 'absolute', left: 126, right: 45, top: 0 },
  titleText: { color: palette.white },
  close: { position: 'absolute', right: 20, top: 9, width: 24, height: 24, borderRadius: 1000, alignItems: 'center', justifyContent: 'center' },
  // Design centres the 106pt-tall stack at y = 240..346 inside the 852pt frame.
  shape: { flex: 1, flexDirection: 'row', gap: 3, alignItems: 'center', justifyContent: 'center' },
  bar: { width: 70, backgroundColor: palette.white },
  options: { paddingHorizontal: 17, gap: 9 },
  option: {
    height: 54,
    borderRadius: 20,
    backgroundColor: darkColors.fillQuaternary,
    justifyContent: 'center',
    paddingLeft: 25,
    paddingRight: 16,
  },
  optionLabel: { color: palette.white },
  optionCheck: { position: 'absolute', right: 16, top: 15 },
  footer: { paddingHorizontal: 16, paddingTop: 20 },
  confirm: {
    height: 54,
    borderRadius: layout.buttonRadius,
    backgroundColor: palette.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
