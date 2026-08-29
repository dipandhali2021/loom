import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  FadeIn,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Icon } from '../../src/components/Icon';
import { AppText } from '../../src/components/AppText';
import { HeroVideo } from '../../src/hero/HeroVideo';
import { PHRASES } from '../../src/hero/phrases';
import { useEmailOtpAuth } from '../../src/auth/useEmailOtpAuth';
import { useGoogleAuth } from '../../src/auth/useGoogleAuth';
import { darkColors, layout, palette, type } from '../../src/theme/tokens';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Clerk's email codes are always six digits. */
const CODE_LENGTH = 6;

/** The repo's open curve (ModelSheet, SourcesSheet). */
const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1);

/** Matches the hero's cross-fade, so the phrase turns over with the footage. */
const WORD_FADE_MS = 900;

/**
 * Below this, the reported frame is a hardware keyboard's accessory bar rather
 * than a keyboard -- lifting the sheet for it would just leave a gap.
 */
const KEYBOARD_MIN_HEIGHT = 120;

/** Android reports no duration for the transition, so this stands in for it. */
const LIFT_MS = 260;

/** Air kept between the status bar and the wordmark when it is pushed upward. */
const WORD_MARGIN = 12;

/** Air kept between the wordmark and the top of the sheet. */
const WORD_GAP = 24;

/**
 * Where the wordmark sits, as a fraction of screen height. Was `top: '32.9%'` in
 * the stylesheet; it is a number now because the keyboard math below has to know
 * where the wordmark starts in order to work out whether the sheet has reached it.
 */
const WORD_TOP_RATIO = 0.329;

/**
 * How far the sheet rises for the keyboard, measured.
 *
 * Measured, the way `ModelSheet` measures it, rather than delegated to a
 * `KeyboardAvoidingView`: that view was here and had no Android behaviour at all,
 * which is why the sheet sat behind the keys, and its two Android options each cost
 * something -- `height` shrinks the container this sheet is anchored inside, and
 * `padding` mis-measures under edge-to-edge. Measuring also puts the lift on the
 * same curve as everything else on this screen.
 *
 * The rise is a `translateY`, deliberately, not padding: the sheet carries a layout
 * transition for the step morph, and moving it by changing its layout would put two
 * animations on the same property at once -- which is the common case here, because
 * opening the email step both changes the step and focuses a field, so the morph and
 * the keyboard land in the same frame. A transform touches no layout at all.
 *
 * It travels the keyboard's full height, no more: that lands the sheet's bottom edge
 * exactly on the top of the keyboard, so the sheet's own bottom padding becomes the
 * standoff between the last control and the keys and no strip of video can open up
 * underneath. Travelling further would lift the fill clear of the keyboard and show
 * one.
 */
function useKeyboardLift() {
  const lift = useSharedValue(0);

  useEffect(() => {
    // `Will` on iOS so the sheet travels with the keyboard rather than after it;
    // Android has no such event and reports the frame once the keys are already up.
    const rising = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const falling = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const shown = Keyboard.addListener(rising, (event) => {
      const height = event.endCoordinates?.height ?? 0;
      lift.value = withTiming(height > KEYBOARD_MIN_HEIGHT ? height : 0, {
        // iOS reports the system duration and Android reports none, so match it
        // where it exists and stand in for it where it does not.
        duration: event.duration || LIFT_MS,
        easing: EASE_OUT,
      });
    });
    const hidden = Keyboard.addListener(falling, (event) => {
      lift.value = withTiming(0, { duration: event.duration || LIFT_MS, easing: EASE_OUT });
    });

    return () => {
      shown.remove();
      hidden.remove();
    };
  }, [lift]);

  return lift;
}

/**
 * The whole of auth, in one screen.
 *
 * The sheet morphs rather than navigating: choices -> email -> code. Which step
 * shows is derived from Clerk's own resources (`pendingVerification`) plus one
 * local flag for the tap that opens the email field, so a remount lands back on
 * the step the live attempt is actually at. Keeping it one route is also what
 * lets the video hero play uninterrupted from launch to signed in -- a route
 * swap would tear the players down and restart them.
 */
export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { pendingVerification, pendingEmail, busy, error, requestCode, resendCode, submitCode, resetFlow } =
    useEmailOtpAuth();
  const google = useGoogleAuth();

  const [emailOpen, setEmailOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [phrase, setPhrase] = useState(0);

  const wordOpacity = useSharedValue(1);
  const wordStyle = useAnimatedStyle(() => ({ opacity: wordOpacity.value }));

  const lift = useKeyboardLift();
  const liftStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -lift.value }] }));

  /*
   * The wordmark gets out of the rising sheet's way.
   *
   * Both boxes are measured rather than assumed: the sheet's height changes with the
   * step -- the email step is taller than the choices -- and the wordmark's with
   * which phrase is showing. So the overlap is taken from what is actually on
   * screen: how far the sheet's lifted top edge has come past the bottom of the
   * wordmark, and only that much is given back. Nothing moves until the sheet
   * actually reaches it, and the travel is capped below the status bar so the
   * wordmark can never be pushed off the top of the screen.
   */
  const { height: windowHeight } = useWindowDimensions();
  const [wordHeight, setWordHeight] = useState(0);
  const wordTop = windowHeight * WORD_TOP_RATIO;
  const wordCeiling = Math.max(0, wordTop - insets.top - WORD_MARGIN);

  /*
   * The sheet's height, on the UI thread and eased.
   *
   * A shared value rather than React state because the wordmark's offset depends on
   * it and on the keyboard at once, and the two arrive from different places: React
   * commits the height, the keyboard listener writes the lift. Reading both here
   * keeps them one number.
   *
   * Later measurements ease over the step morph's own duration, so the wordmark
   * drifts with the growing sheet instead of jumping a step ahead of it. The first
   * one lands instantly -- there is nothing to animate away from on mount.
   */
  const sheetHeight = useSharedValue(0);
  const onSheetLayout = useCallback(
    (height: number) => {
      sheetHeight.value =
        sheetHeight.value === 0 ? height : withTiming(height, { duration: 320, easing: EASE_OUT });
    },
    [sheetHeight],
  );

  const wordShift = useAnimatedStyle(() => {
    const sheetTop = windowHeight - sheetHeight.value - lift.value;
    const overlap = wordTop + wordHeight + WORD_GAP - sheetTop;
    return { transform: [{ translateY: -Math.min(Math.max(overlap, 0), wordCeiling) }] };
  });

  /*
   * The wordmark turns over on the hero's beat: down as the outgoing clip fades,
   * up under the incoming one, so one dissolve covers both, and the swap happens
   * at the bottom of the dip where there is nothing to see.
   */
  const onBeat = useCallback(() => {
    wordOpacity.value = withTiming(0, { duration: WORD_FADE_MS / 2, easing: EASE_OUT }, (done) => {
      if (!done) return;
      wordOpacity.value = withTiming(1, { duration: WORD_FADE_MS / 2, easing: EASE_OUT });
    });
    setTimeout(() => setPhrase((i) => (i + 1) % PHRASES.length), WORD_FADE_MS / 2);
  }, [wordOpacity]);

  // Clerk is holding a code, so the sheet is on that step whatever was tapped.
  const step: 'choices' | 'email' | 'code' = pendingVerification ? 'code' : emailOpen ? 'email' : 'choices';

  const emailValid = EMAIL_RE.test(email.trim());
  const codeComplete = code.length === CODE_LENGTH;

  /*
   * Submit as soon as the sixth digit lands -- the expected behaviour for a
   * one-time code, and what makes autofill from the notification work in one
   * tap. The ref makes a given code submit once: without it every re-render
   * while the request is in flight would fire another attempt, and after a
   * rejection the value only becomes submittable again once it is edited.
   */
  const submitted = useRef<string | null>(null);
  useEffect(() => {
    if (step !== 'code' || !codeComplete || busy || submitted.current === code) return;
    submitted.current = code;
    void submitCode(code);
  }, [busy, code, codeComplete, step, submitCode]);

  /** Throw away typed digits, so the next attempt starts from an empty field. */
  const clearCode = useCallback(() => {
    setCode('');
    submitted.current = null;
  }, []);

  const word = PHRASES[phrase];
  // The auth sheet is always dark in the design, regardless of the app theme.
  const sheet = useMemo(() => darkColors, []);

  return (
    <View style={styles.screen}>
      <HeroVideo onBeat={onBeat} />

      <Animated.View
        style={[styles.logo, { top: wordTop }, wordStyle, wordShift]}
        onLayout={(event) => setWordHeight(event.nativeEvent.layout.height)}
        pointerEvents="none"
      >
        {word ? (
          <AppText tone="none" style={[type.wordmark, styles.word]}>
            {word}
          </AppText>
        ) : null}
        <View style={styles.dot} />
      </Animated.View>

      {/*
       * The lift and the step morph are on separate views on purpose: one animates a
       * transform, the other animates layout, and a single view carrying both would
       * be running two animations over the same frames whenever opening the email
       * step raises the keyboard -- which is every time.
       */}
      <Animated.View style={[styles.push, liftStyle]}>
        <Animated.View
          layout={LinearTransition.duration(320).easing(EASE_OUT)}
          onLayout={(event) => onSheetLayout(event.nativeEvent.layout.height)}
          style={[
            styles.sheet,
            {
              backgroundColor: sheet.fillQuaternary,
              paddingBottom: Math.max(insets.bottom, 20),
            },
          ]}
        >
          {step === 'choices' ? (
            <Choices
              key="choices"
              sheet={sheet}
              onEmail={() => setEmailOpen(true)}
              onGoogle={() => void google.signInWithGoogle()}
              googleAvailable={google.available}
              googleBusy={google.busy}
            />
          ) : step === 'email' ? (
            <EmailStep
              key="email"
              sheet={sheet}
              email={email}
              onChange={setEmail}
              onBack={() => {
                setEmailOpen(false);
                setEmail('');
              }}
              onSubmit={() => void requestCode(email.trim())}
              blocked={!emailValid || busy}
              busy={busy}
            />
          ) : (
            <CodeStep
              key="code"
              sheet={sheet}
              code={code}
              onChange={(next) => setCode(next.replace(/\D/g, '').slice(0, CODE_LENGTH))}
              address={pendingEmail}
              onSubmit={() => void submitCode(code)}
              onResend={() => {
                // A fresh code invalidates the old one, so clear the stale digits.
                clearCode();
                void resendCode();
              }}
              onBack={() => {
                // Local-only reset: there is no session yet, just an attempt.
                clearCode();
                setEmailOpen(true);
                void resetFlow();
              }}
              blocked={!codeComplete || busy}
              busy={busy}
            />
          )}

          {/*
           * One error line for both flows. They cannot fail at the same time --
           * the Google button only exists on the step that has no email request
           * in flight -- so whichever is set is the current one.
           */}
          {error ?? google.error ? (
            <Animated.View entering={FadeIn.duration(180)}>
              <AppText tone="none" style={[type.footnote, styles.error, { color: palette.danger }]}>
                {error ?? google.error}
              </AppText>
            </Animated.View>
          ) : null}
        </Animated.View>
      </Animated.View>
    </View>
  );
}

/** The first step: how to sign in. Google is live; Apple is iOS-only and still inert. */
function Choices({
  sheet,
  onEmail,
  onGoogle,
  googleAvailable,
  googleBusy,
}: {
  sheet: typeof darkColors;
  onEmail: () => void;
  onGoogle: () => void;
  googleAvailable: boolean;
  googleBusy: boolean;
}) {
  return (
    <Animated.View entering={FadeIn.duration(240)} style={styles.stack}>
      {/*
       * Apple only on iOS: it is the platform's own account, and offering it on
       * Android would promise something the device cannot do. Still inert -- it
       * needs its own credentials and an Apple Developer account, neither of which
       * is set up -- so it reads as unavailable rather than failing on press.
       *
       * Note for whoever wires it: App Store guideline 4.8 requires Sign in with
       * Apple on any iOS app that offers another third-party social sign-in, and
       * Google below is now one. So this is a blocker for an App Store submission,
       * though not for Android.
       */}
      {Platform.OS === 'ios' ? (
        <AuthButton
          label="Continue with Apple"
          icon={<Icon name="apple" size={14} color={palette.black} />}
          background={palette.white}
          textColor={palette.black}
          disabled
          onPress={() => {}}
        />
      ) : null}
      {/*
       * Google goes through the OS account picker, so it needs a native build and
       * the client IDs -- `googleAvailable` is false without either, and the row
       * then reads as unavailable rather than throwing from the missing native
       * module. It is hidden rather than disabled where it cannot work at all
       * (web), because a permanently dead row is worse than no row.
       */}
      {googleAvailable || Platform.OS !== 'web' ? (
        <AuthButton
          label="Continue with Google"
          icon={<Icon name="google" size={16} />}
          background={sheet.fillPrimary}
          textColor={palette.white}
          disabled={!googleAvailable || googleBusy}
          busy={googleBusy}
          spinnerColor={palette.white}
          onPress={onGoogle}
        />
      ) : null}
      {/*
       * One email row, not two: the code request tries a sign-in and falls back
       * to a sign-up, so the address itself decides which happens and asking up
       * front would be busywork -- and a wrong guess would send someone to the
       * wrong screen.
       */}
      <AuthButton
        label="Continue with email"
        icon={<Icon name="mail" size={24} color={palette.white} />}
        background={sheet.fillPrimary}
        textColor={palette.white}
        onPress={onEmail}
      />
    </Animated.View>
  );
}

/** The address. Same field and copy the old signup route carried. */
function EmailStep({
  sheet,
  email,
  onChange,
  onBack,
  onSubmit,
  blocked,
  busy,
}: {
  sheet: typeof darkColors;
  email: string;
  onChange: (next: string) => void;
  onBack: () => void;
  onSubmit: () => void;
  blocked: boolean;
  busy: boolean;
}) {
  return (
    <Animated.View entering={FadeIn.duration(240)} style={styles.stack}>
      <StepHeader title="What’s your email?" subtitle="We’ll send a code to confirm it’s you. No password needed." />
      <TextInput
        value={email}
        onChangeText={onChange}
        placeholder="you@example.com"
        placeholderTextColor={sheet.labelTertiary}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        autoFocus
        editable={!busy}
        returnKeyType="go"
        onSubmitEditing={() => {
          if (!blocked) onSubmit();
        }}
        style={[styles.input, type.bodyRegular, { color: palette.white, borderColor: sheet.separatorOpaque }]}
        accessibilityLabel="Email address"
      />
      {/*
       * No navigation on submit: the sheet's step is derived from the live Clerk
       * attempt, so requesting a code is what moves it on.
       */}
      <PrimaryButton label="Continue" onPress={onSubmit} blocked={blocked} busy={busy} />
      <TextButton label="Back" onPress={onBack} />
    </Animated.View>
  );
}

/** The code. Same six-digit field and auto-submit the old verify route carried. */
function CodeStep({
  sheet,
  code,
  onChange,
  address,
  onSubmit,
  onResend,
  onBack,
  blocked,
  busy,
}: {
  sheet: typeof darkColors;
  code: string;
  onChange: (next: string) => void;
  address: string | null;
  onSubmit: () => void;
  onResend: () => void;
  onBack: () => void;
  blocked: boolean;
  busy: boolean;
}) {
  return (
    <Animated.View entering={FadeIn.duration(240)} style={styles.stack}>
      <StepHeader
        title="Check your email"
        subtitle={`Enter the ${CODE_LENGTH}-digit code we sent to ${address ?? 'your inbox'}.`}
      />
      <TextInput
        value={code}
        onChangeText={onChange}
        placeholder="000000"
        placeholderTextColor={sheet.labelTertiary}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={CODE_LENGTH}
        autoFocus
        editable={!busy}
        style={[
          styles.input,
          styles.codeInput,
          type.bodySemibold,
          { color: palette.white, borderColor: sheet.separatorOpaque },
        ]}
        accessibilityLabel="Verification code"
      />
      <PrimaryButton label="Verify" onPress={onSubmit} blocked={blocked} busy={busy} />
      <TextButton label="Send a new code" onPress={onResend} disabled={busy} />
      <TextButton label="Use a different email" onPress={onBack} />
    </Animated.View>
  );
}

function StepHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <View style={styles.header}>
      <AppText tone="none" style={[type.bodySemibold, styles.headerTitle]}>
        {title}
      </AppText>
      <AppText tone="none" style={[type.footnote, styles.headerSubtitle]}>
        {subtitle}
      </AppText>
    </View>
  );
}

function PrimaryButton({
  label,
  onPress,
  blocked,
  busy,
}: {
  label: string;
  onPress: () => void;
  blocked: boolean;
  busy: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={blocked}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: palette.white, opacity: blocked ? 0.3 : pressed ? 0.85 : 1 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: blocked, busy }}
    >
      {busy ? (
        <ActivityIndicator color={palette.black} />
      ) : (
        <AppText tone="none" style={[type.authButton, { color: palette.black }]}>
          {label}
        </AppText>
      )}
    </Pressable>
  );
}

function TextButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.textButton, { opacity: disabled ? 0.4 : pressed ? 0.6 : 1 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
    >
      <AppText tone="none" style={[type.footnote, styles.textButtonLabel]}>
        {label}
      </AppText>
    </Pressable>
  );
}

function AuthButton({
  label,
  icon,
  background,
  textColor,
  disabled,
  busy,
  spinnerColor,
  onPress,
}: {
  label: string;
  icon?: React.ReactNode;
  background: string;
  textColor: string;
  disabled?: boolean;
  busy?: boolean;
  spinnerColor?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        /*
         * A busy button keeps its full opacity while it is disabled: the flow it
         * started is a system sheet over this screen, and dimming the row it came
         * from would read as the press having failed. Only an unavailable row dims.
         */
        { backgroundColor: background, opacity: disabled && !busy ? 0.35 : pressed ? 0.8 : 1 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, busy: !!busy }}
      accessibilityHint={disabled && !busy ? 'Not available yet. Use email instead.' : undefined}
    >
      {busy ? (
        <ActivityIndicator color={spinnerColor ?? textColor} />
      ) : (
        <>
          {icon}
          <AppText tone="none" style={[type.authButton, { color: textColor }]}>
            {label}
          </AppText>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'flex-end', backgroundColor: palette.black },
  push: { justifyContent: 'flex-end' },
  // `top` is applied inline, from the window's height -- see WORD_TOP_RATIO.
  logo: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  // White on the dimmed video in every variant now, so the per-variant ink is gone.
  word: { color: palette.white },
  dot: { width: 33, height: 33, borderRadius: 16.5, backgroundColor: palette.white },
  /*
   * Grey rather than black, so the sheet is its own surface: the scrim behind it
   * reaches black at the bottom of the screen, and a black sheet on that read as
   * nothing at all -- the buttons looked like they floated on the video. The
   * hairline is still there to pick out the rounded top against the scrim.
   */
  sheet: {
    borderTopLeftRadius: layout.authSheetRadius,
    borderTopRightRadius: layout.authSheetRadius,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: darkColors.separatorOpaque,
    paddingTop: 25,
    paddingHorizontal: 25,
    gap: 12,
  },
  error: { marginTop: 2, textAlign: 'center' },
  stack: { gap: 12 },
  header: { gap: 4, marginBottom: 4 },
  headerTitle: { color: palette.white },
  headerSubtitle: { color: darkColors.labelSecondary },
  // Same height as the buttons it sits among, so the sheet stays one rhythm.
  input: {
    height: 50,
    borderWidth: 1,
    borderRadius: layout.buttonRadius,
    paddingHorizontal: 16,
  },
  // Six digits read as a group rather than a number when they are spaced out.
  codeInput: { textAlign: 'center', letterSpacing: 8 },
  button: {
    height: 50,
    borderRadius: layout.buttonRadius,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  textButton: { height: 40, alignItems: 'center', justifyContent: 'center' },
  textButtonLabel: { color: darkColors.labelSecondary },
});
