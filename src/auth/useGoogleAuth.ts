import { useCallback, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { useSignInWithGoogle } from '@clerk/expo/google';

/**
 * Sign in with Google, native.
 *
 * The OS account picker rather than a browser: Credential Manager on Android,
 * `ASAuthorization` on iOS when the URL scheme is configured. Clerk's hook does
 * the ID-token exchange and, for an address it has never seen, transfers the
 * attempt to a sign-up itself -- so one button covers both halves, the same way
 * the email step does.
 *
 * Shaped like `useEmailOtpAuth` on purpose (`busy`, `error`, one async action) so
 * the login sheet drives both the same way. Unlike the email flow, this hook's
 * method *throws* rather than resolving `{ error }`: it is not one of Clerk v4's
 * signal-hook methods, so every call is wrapped.
 *
 * Requires a native build. There is no native module in Expo Go, and pressing the
 * button there would throw from the shim rather than do nothing, which is why
 * `available` gates it.
 */

/** iOS and Android only; the web export is a stub that throws when called. */
const NATIVE = Platform.OS === 'ios' || Platform.OS === 'android';

/**
 * Read a client ID the way the SDK does, and in the same order.
 *
 * `extra` first, `process.env` second. The second read only ever resolves while
 * Metro is serving the bundle -- Expo does not inline `EXPO_PUBLIC_*` into
 * `node_modules`, so the copy of this lookup inside `@clerk/expo` sees nothing in
 * a release build. `app.config.ts` mirrors these into `extra` for exactly that
 * reason; this function agreeing with the SDK is what keeps the button's enabled
 * state honest about whether pressing it can actually work.
 */
function clientId(fromEnv: string | undefined, key: string): string | undefined {
  const extra = Constants.expoConfig?.extra as Record<string, string | undefined> | undefined;
  return extra?.[key] || fromEnv;
}

/**
 * Whether the credentials this platform needs are present.
 *
 * The web client ID is the audience Clerk verifies Google's ID token against, so
 * it is required on both platforms even though neither device signs in with it.
 * iOS additionally needs its own client ID -- the hook refuses to start without
 * one. Android needs no client ID at all: the credential picker identifies the
 * app by package name and signing certificate, which is why the Clerk dashboard
 * asks for a SHA-256 fingerprint instead.
 */
function credentialsPresent(): boolean {
  const web = clientId(
    process.env.EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID,
    'EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID',
  );
  if (!web) return false;
  if (Platform.OS !== 'ios') return true;
  return !!clientId(
    process.env.EXPO_PUBLIC_CLERK_GOOGLE_IOS_CLIENT_ID,
    'EXPO_PUBLIC_CLERK_GOOGLE_IOS_CLIENT_ID',
  );
}

/**
 * Codes that mean "the user changed their mind", which is not a failure and gets
 * no error copy. `-5` is the raw Google SDK cancellation code, which reaches us
 * unmapped on some devices.
 */
const CANCELLED = new Set(['SIGN_IN_CANCELLED', '-5']);

type ClerkFieldError = { code: string; message: string; longMessage?: string };

/** Same shape `useEmailOtpAuth` reads; see the note on `ClerkErrorLike` there. */
type ClerkErrorLike = {
  code?: string;
  message?: string;
  longMessage?: string;
  errors?: ClerkFieldError[];
};

function asError(error: unknown): ClerkErrorLike {
  return (error ?? {}) as ClerkErrorLike;
}

function wasCancelled(error: ClerkErrorLike): boolean {
  return !!error.code && CANCELLED.has(error.code);
}

/**
 * The most specific user-facing copy the failure carries, preferring the nested
 * field error: the outer message of an API rejection is developer-facing.
 */
function messageFor(error: ClerkErrorLike): string {
  const field = error.errors?.[0];
  return (
    field?.longMessage ??
    field?.message ??
    error.longMessage ??
    error.message ??
    'Google sign-in did not complete. Try again, or use email.'
  );
}

export type GoogleAuth = {
  /** Whether the button should do anything: native build, credentials present. */
  available: boolean;
  /** A request is in flight. */
  busy: boolean;
  /** User-facing copy for the last failure, or null. */
  error: string | null;
  /** Run the flow. Resolves true once a session is active. */
  signInWithGoogle: () => Promise<boolean>;
};

export function useGoogleAuth(): GoogleAuth {
  const { startGoogleAuthenticationFlow } = useSignInWithGoogle();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Neither input can change while the app is running, so this is settled once.
  const available = useMemo(() => NATIVE && credentialsPresent(), []);

  const signInWithGoogle = useCallback(async () => {
    if (!available || busy) return false;
    setError(null);
    setBusy(true);
    try {
      const { createdSessionId, setActive } = await startGoogleAuthenticationFlow();

      /*
       * No session and no error means the picker was dismissed -- the native shim
       * maps cancellation to an empty result rather than throwing. Silence is the
       * right response: the user closed it deliberately.
       */
      if (!createdSessionId || !setActive) return false;

      // Activating the session is what flips the root guard; routing here is
      // declarative, owned by <Stack.Protected>, so nothing navigates.
      await setActive({ session: createdSessionId });
      return true;
    } catch (thrown) {
      const failure = asError(thrown);
      if (wasCancelled(failure)) return false;
      setError(messageFor(failure));
      return false;
    } finally {
      setBusy(false);
    }
  }, [available, busy, startGoogleAuthenticationFlow]);

  return useMemo(
    () => ({ available, busy, error, signInWithGoogle }),
    [available, busy, error, signInWithGoogle],
  );
}
