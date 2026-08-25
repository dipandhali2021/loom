import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../../src/components/Icon';
import { AppText } from '../../src/components/AppText';
import { useTheme } from '../../src/theme/ThemeProvider';
import { useEmailOtpAuth } from '../../src/auth/useEmailOtpAuth';
import { layout, palette, type } from '../../src/theme/tokens';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Email entry. The Figma section jumps from the login sheet straight to
 * "Email Verification", so this step carries the design's button and field
 * styling to collect the address that screen then displays.
 *
 * It serves logging in and signing up alike: `requestCode` tries a sign-in and
 * falls back to a sign-up, so the address decides which happens.
 */
export default function SignUpScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { requestCode, busy, error } = useEmailOtpAuth();
  const [email, setEmail] = useState('');
  const valid = EMAIL_RE.test(email.trim());
  const blocked = !valid || busy;

  return (
    <View style={[styles.screen, { backgroundColor: colors.bgPrimary, paddingTop: insets.top }]}>
      <View style={styles.navBar}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <Icon name="chevron-left" size={24} color={colors.labelPrimary} />
        </Pressable>
        <AppText variant="bodySemibold">Continue with email</AppText>
        <View style={styles.navSpacer} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.body}
        keyboardVerticalOffset={insets.top + layout.navBarHeight}
      >
        <View style={styles.content}>
          <AppText tone="primary" style={type.verifyTitle}>
            What’s your email?
          </AppText>
          <AppText variant="bodyRegular" tone="secondary" style={styles.subtitle}>
            We’ll send a code to confirm it’s you. No password needed.
          </AppText>

          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={colors.labelTertiary}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            autoFocus
            editable={!busy}
            returnKeyType="go"
            onSubmitEditing={() => {
              if (!blocked) void requestCode(email.trim());
            }}
            style={[
              styles.input,
              type.bodyRegular,
              { color: colors.labelPrimary, borderColor: colors.separatorNonOpaque },
            ]}
            accessibilityLabel="Email address"
          />

          {error ? (
            <AppText tone="none" style={[type.footnote, styles.error, { color: palette.danger }]}>
              {error}
            </AppText>
          ) : null}
        </View>

        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 17) }]}>
          <Pressable
            /*
             * No navigation here on purpose: once Clerk holds an unverified
             * attempt the (auth) layout's guards swap in verify-email on their
             * own, so pushing a route as well would stack a second copy of it.
             */
            onPress={() => void requestCode(email.trim())}
            disabled={blocked}
            style={({ pressed }) => [
              styles.cta,
              {
                backgroundColor: colors.accent,
                opacity: blocked ? 0.3 : pressed ? 0.85 : 1,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Continue"
            accessibilityState={{ disabled: blocked, busy }}
          >
            {busy ? (
              <ActivityIndicator color={colors.accentOn} />
            ) : (
              <AppText tone="none" style={[type.bodySemibold, { color: colors.accentOn }]}>
                Continue
              </AppText>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
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
  navSpacer: { width: 24 },
  body: { flex: 1, justifyContent: 'space-between' },
  content: { paddingHorizontal: 17, paddingTop: 40, gap: 8 },
  subtitle: { marginBottom: 24 },
  // Same height as the chat type box, so a type area is one size app-wide.
  input: {
    height: layout.inputHeight,
    borderWidth: 1,
    borderRadius: layout.buttonRadius,
    paddingHorizontal: 16,
  },
  error: { marginTop: 10 },
  footer: { paddingHorizontal: 17 },
  cta: {
    height: layout.inputHeight,
    borderRadius: layout.buttonRadius,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
