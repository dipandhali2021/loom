import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../../src/components/Icon';
import { AppText } from '../../src/components/AppText';
import { darkColors, layout, palette, type } from '../../src/theme/tokens';

/**
 * The four Login variants in the Figma section are one screen whose backdrop and
 * wordmark rotate. Login 1 shows the bare dot; 2/3/4 pair a phrase with it.
 */
const VARIANTS = [
  { background: palette.brandBlue, word: null, wordColor: palette.white, dot: palette.white },
  { background: '#225453', word: 'ChatGPT', wordColor: '#F6CB92', dot: '#F6CB92' },
  { background: '#FDF1D9', word: 'Let’s brainstorm', wordColor: palette.brandBlue, dot: palette.brandBlue },
  { background: '#FDF1D9', word: 'Let’s go', wordColor: palette.brandBlue, dot: palette.brandBlue },
] as const;

const CYCLE_MS = 2600;

export default function LoginScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  const fade = useRef(new Animated.Value(1)).current;

  // Cross-fade between the wordmark variants, matching the design's "Logo Animation".
  useEffect(() => {
    const timer = setInterval(() => {
      Animated.sequence([
        Animated.timing(fade, { toValue: 0, duration: 320, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(fade, { toValue: 1, duration: 380, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]).start();
      setTimeout(() => setIndex((i) => (i + 1) % VARIANTS.length), 320);
    }, CYCLE_MS);
    return () => clearInterval(timer);
  }, [fade]);

  const variant = VARIANTS[index];
  // The auth sheet is always dark in the design, regardless of the app theme.
  const sheet = useMemo(() => darkColors, []);

  return (
    <View style={[styles.screen, { backgroundColor: variant.background }]}>
      <Animated.View style={[styles.logo, { opacity: fade }]}>
        {variant.word ? (
          <AppText tone="none" style={[type.wordmark, { color: variant.wordColor }]}>
            {variant.word}
          </AppText>
        ) : null}
        <View style={[styles.dot, { backgroundColor: variant.dot }]} />
      </Animated.View>

      <View
        style={[
          styles.sheet,
          {
            backgroundColor: sheet.bgPrimary,
            paddingBottom: Math.max(insets.bottom, 20),
          },
        ]}
      >
        {/*
          * Email is the only strategy enabled on the Clerk instance right now.
          * The social buttons stay in place because the design's sheet is built
          * around four rows, but they are inert until an OAuth provider is
          * configured -- pressing them cannot sign anyone in, so they read as
          * unavailable rather than silently failing.
          */}
        <AuthButton
          label="Continue with Apple"
          icon={<Icon name="apple" size={14} color={palette.black} />}
          background={palette.white}
          textColor={palette.black}
          disabled
          onPress={() => {}}
        />
        <AuthButton
          label="Continue with Google"
          icon={<Icon name="google" size={16} />}
          background={sheet.fillPrimary}
          textColor={palette.white}
          disabled
          onPress={() => {}}
        />
        {/*
          * Both email rows lead to the same screen: the code request tries a
          * sign-in first and falls back to sign-up, so the address itself
          * decides which one happens and asking up front would be busywork.
          */}
        <AuthButton
          label="Sign up with email"
          icon={<Icon name="mail" size={24} color={palette.white} />}
          background={sheet.fillPrimary}
          textColor={palette.white}
          onPress={() => router.push('/signup')}
        />
        <AuthButton
          label="Log in"
          background={sheet.bgPrimary}
          textColor={palette.white}
          borderColor={sheet.separatorNonOpaque}
          onPress={() => router.push('/signup')}
        />
      </View>
    </View>
  );
}

function AuthButton({
  label,
  icon,
  background,
  textColor,
  borderColor,
  disabled,
  onPress,
}: {
  label: string;
  icon?: React.ReactNode;
  background: string;
  textColor: string;
  borderColor?: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: background,
          opacity: disabled ? 0.35 : pressed ? 0.8 : 1,
          borderWidth: borderColor ? 1.5 : 0,
          borderColor,
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      accessibilityHint={disabled ? 'Not available yet. Use email instead.' : undefined}
    >
      {icon}
      <AppText tone="none" style={[type.authButton, { color: textColor }]}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'flex-end' },
  logo: {
    position: 'absolute',
    top: '32.9%',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  dot: { width: 33, height: 33, borderRadius: 16.5 },
  sheet: {
    borderTopLeftRadius: layout.authSheetRadius,
    borderTopRightRadius: layout.authSheetRadius,
    paddingTop: 25,
    paddingHorizontal: 25,
    gap: 12,
  },
  button: {
    height: 50,
    borderRadius: layout.buttonRadius,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
});
