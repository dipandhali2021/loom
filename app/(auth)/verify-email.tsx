import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../../src/components/Icon';
import { AppText } from '../../src/components/AppText';
import { useTheme } from '../../src/theme/ThemeProvider';
import { useChatStore } from '../../src/store/ChatStore';
import { useEmailOtpAuth } from '../../src/auth/useEmailOtpAuth';
import { layout, palette, type } from '../../src/theme/tokens';

/** Clerk's email codes are always six digits. */
const CODE_LENGTH = 6;

/**
 * Email Verification (Figma 36:670): mail glyph, title, target address, buttons.
 * The design showed a magic link; Clerk's `email_code` strategy sends a code
 * instead, so the address line is followed by a field for it.
 */
export default function VerifyEmailScreen() {
  const insets = useSafeAreaInsets();
  const { colors, scheme } = useTheme();
  const { signOut } = useChatStore();
  const { pendingEmail, submitCode, resendCode, busy, error } = useEmailOtpAuth();
  const [code, setCode] = useState('');

  const buttonBg = scheme === 'dark' ? colors.fillPrimary : palette.buttonGrayLight;
  const complete = code.length === CODE_LENGTH;

  /*
   * Submit as soon as the sixth digit lands -- the expected behaviour for a
   * one-time code, and what makes autofill from the notification work in one
   * tap. The ref makes a given code submit once: without it every re-render
   * while the request is in flight would fire another attempt, and after a
   * rejection the value only becomes submittable again once it is edited.
   */
  const submitted = useRef<string | null>(null);
  useEffect(() => {
    if (!complete || busy || submitted.current === code) return;
    submitted.current = code;
    void submitCode(code);
  }, [busy, code, complete, submitCode]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.screen, { backgroundColor: colors.bgPrimary }]}
    >
      <View style={styles.center}>
        <Icon name="mail-big" size={84} color={colors.labelPrimary} />
        <AppText tone="primary" style={[type.verifyTitle, styles.title]}>
          Verify your email
        </AppText>
        <AppText variant="bodyRegular" tone="secondary" style={styles.line}>
          Enter the {CODE_LENGTH}-digit code we sent to
        </AppText>
        <AppText variant="bodyRegular" tone="secondary" style={styles.emailLine}>
          {pendingEmail ?? 'your inbox'}
        </AppText>

        <TextInput
          value={code}
          // Strip anything that is not a digit so a pasted "123 456" still fits.
          onChangeText={(next) => setCode(next.replace(/\D/g, '').slice(0, CODE_LENGTH))}
          placeholder="000000"
          placeholderTextColor={colors.labelTertiary}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="sms-otp"
          maxLength={CODE_LENGTH}
          autoFocus
          editable={!busy}
          style={[
            styles.input,
            type.verifyTitle,
            { color: colors.labelPrimary, borderColor: colors.separatorNonOpaque },
          ]}
          accessibilityLabel="Verification code"
        />

        {error ? (
          <AppText tone="none" style={[type.footnote, styles.error, { color: palette.danger }]}>
            {error}
          </AppText>
        ) : null}
      </View>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 20) }]}>
        <Pressable
          onPress={() => void submitCode(code)}
          disabled={!complete || busy}
          style={({ pressed }) => [
            styles.button,
            {
              backgroundColor: colors.accent,
              opacity: !complete || busy ? 0.3 : pressed ? 0.85 : 1,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Verify"
          accessibilityState={{ disabled: !complete || busy, busy }}
        >
          {busy ? (
            <ActivityIndicator color={colors.accentOn} />
          ) : (
            <AppText tone="none" style={[type.bodySemibold, { color: colors.accentOn }]}>
              Verify
            </AppText>
          )}
        </Pressable>
        <Pressable
          onPress={() => {
            // A fresh code invalidates the old one, so clear the stale digits too.
            setCode('');
            submitted.current = null;
            void resendCode();
          }}
          disabled={busy}
          style={({ pressed }) => [styles.button, { backgroundColor: buttonBg, opacity: pressed ? 0.8 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel="Send a new code"
        >
          <AppText variant="bodySemibold">Send a new code</AppText>
        </Pressable>
        <Pressable
          onPress={signOut}
          style={({ pressed }) => [styles.cancel, { opacity: pressed ? 0.6 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel="Use a different email"
        >
          <AppText variant="bodyRegular" tone="secondary">
            Use a different email
          </AppText>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'space-between' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 40, paddingHorizontal: 17 },
  title: { marginTop: 19, textAlign: 'center' },
  line: { marginTop: 17 },
  emailLine: { marginTop: 1 },
  // Wide enough for six digits at title size, with the tracking that spaces them out.
  input: {
    marginTop: 28,
    minWidth: 220,
    height: layout.inputHeight,
    borderWidth: 1,
    borderRadius: layout.buttonRadius,
    paddingHorizontal: 16,
    textAlign: 'center',
    letterSpacing: 8,
  },
  error: { marginTop: 14, textAlign: 'center' },
  footer: { paddingHorizontal: 17, gap: 12 },
  button: {
    height: 55,
    borderRadius: layout.buttonRadius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancel: { height: 40, alignItems: 'center', justifyContent: 'center' },
});
