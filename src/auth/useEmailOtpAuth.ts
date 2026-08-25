import { useCallback, useMemo, useState } from 'react';
import { useAuth, useSignIn, useSignUp, useUser } from '@clerk/expo';

/**
 * Passwordless email-code auth, mapped onto the app's existing guard machine.
 *
 * Clerk v4's `useSignIn`/`useSignUp` are signal hooks: they return
 * `{ signIn | signUp, errors, fetchStatus }` with no `isLoaded` and no
 * `setActive`, and every mutating method *resolves* `{ error }` rather than
 * throwing. So each call site reads the returned error -- try/catch would
 * silently pass over a failed request.
 */

/**
 * The slice of Clerk's `ClerkError` these call sites read. Structural rather than
 * imported: `@clerk/expo` does not re-export the type, and `@clerk/shared` -- where
 * it lives -- is a transitive dependency with no `./error` subpath to import from.
 */
type ClerkErrorLike = { code: string; message: string; longMessage?: string };

/** Clerk sends a code to an address it has never seen only via sign-up. */
const IDENTIFIER_NOT_FOUND = 'form_identifier_not_found';
/** ...and refuses to sign an existing address *up*, which sends us the other way. */
const IDENTIFIER_EXISTS = 'form_identifier_exists';

export type EmailOtpFlow = 'sign-in' | 'sign-up' | null;

export type EmailOtpAuth = {
  /**
   * True while a code is outstanding. Derived from Clerk's own resources rather
   * than a local boolean, so it cannot drift out of sync with the attempt it
   * describes, and a remount mid-flow lands back on the verify screen.
   */
  pendingVerification: boolean;
  /** Which half of the flow issued the outstanding code. */
  flow: EmailOtpFlow;
  /** The address the code went to, read back off the live Clerk attempt. */
  pendingEmail: string | null;
  /** A request is in flight; disable submit buttons. */
  busy: boolean;
  /** User-facing copy for the last failure, or null. */
  error: string | null;
  /** Send a code, creating the account if the address is new. */
  requestCode: (email: string) => Promise<boolean>;
  /** Re-send to the address already on the attempt. */
  resendCode: () => Promise<boolean>;
  /** Verify the code and, on success, activate the session. */
  submitCode: (code: string) => Promise<boolean>;
  /** Abandon the outstanding attempt and return to the start of the flow. */
  resetFlow: () => Promise<void>;
};

function messageFor(error: ClerkErrorLike): string {
  return error.longMessage ?? error.message;
}

export function useEmailOtpAuth(): EmailOtpAuth {
  const { isSignedIn } = useAuth();
  const { user } = useUser();
  const { signIn, fetchStatus: signInFetch } = useSignIn();
  const { signUp, fetchStatus: signUpFetch } = useSignUp();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // A sign-up that exists, has its email unconfirmed, and wants nothing else
  // from us. `missingFields` must be empty or `finalize()` is unreachable --
  // that is the shape a stray "Password" toggle in the Clerk dashboard takes.
  const signUpPending =
    !!signUp.id &&
    signUp.status === 'missing_requirements' &&
    signUp.unverifiedFields.includes('email_address') &&
    signUp.missingFields.length === 0;

  // For sign-in the identifier is already accepted and a factor is outstanding.
  const signInPending = !!signIn.id && signIn.status === 'needs_first_factor';

  // An active session outranks any leftover attempt.
  const flow: EmailOtpFlow = isSignedIn
    ? null
    : signUpPending
      ? 'sign-up'
      : signInPending
        ? 'sign-in'
        : null;

  const pendingEmail = isSignedIn
    ? (user?.primaryEmailAddress?.emailAddress ?? null)
    : flow === 'sign-up'
      ? signUp.emailAddress
      : flow === 'sign-in'
        ? signIn.identifier
        : null;

  const requestCode = useCallback(
    async (rawEmail: string) => {
      const emailAddress = rawEmail.trim();
      if (!emailAddress) return false;
      setError(null);
      setSubmitting(true);
      try {
        // Try sign-in first: returning users are the common case, and it avoids
        // leaving an orphan sign-up attempt behind for an address that exists.
        const attempt = await signIn.emailCode.sendCode({ emailAddress });
        if (!attempt.error) return true;
        if (attempt.error.code !== IDENTIFIER_NOT_FOUND) {
          setError(messageFor(attempt.error));
          return false;
        }

        // Unknown address, so this is a first-time user: register, then send.
        const created = await signUp.create({ emailAddress });
        if (created.error) {
          // Raced with another attempt that claimed the address; retry sign-in.
          if (created.error.code === IDENTIFIER_EXISTS) {
            const retry = await signIn.emailCode.sendCode({ emailAddress });
            if (retry.error) {
              setError(messageFor(retry.error));
              return false;
            }
            return true;
          }
          setError(messageFor(created.error));
          return false;
        }

        const sent = await signUp.verifications.sendEmailCode();
        if (sent.error) {
          setError(messageFor(sent.error));
          return false;
        }
        return true;
      } finally {
        setSubmitting(false);
      }
    },
    [signIn, signUp],
  );

  const resendCode = useCallback(async () => {
    setError(null);
    setSubmitting(true);
    try {
      // Both no-arg forms reuse the address already on the attempt.
      const sent =
        flow === 'sign-up'
          ? await signUp.verifications.sendEmailCode()
          : await signIn.emailCode.sendCode();
      if (sent.error) {
        setError(messageFor(sent.error));
        return false;
      }
      return true;
    } finally {
      setSubmitting(false);
    }
  }, [flow, signIn, signUp]);

  const submitCode = useCallback(
    async (rawCode: string) => {
      const code = rawCode.trim();
      if (!code) return false;
      setError(null);
      setSubmitting(true);
      try {
        if (flow === 'sign-up') {
          const verified = await signUp.verifications.verifyEmailCode({ code });
          if (verified.error) {
            setError(messageFor(verified.error));
            return false;
          }
          if (signUp.status !== 'complete') {
            setError('That did not complete sign-up. Request a new code and try again.');
            return false;
          }
          // `finalize` activates the session, which flips the root guard. The
          // no-op navigate keeps Clerk from driving navigation itself -- routing
          // here is declarative, owned by <Stack.Protected>.
          const done = await signUp.finalize({ navigate: () => {} });
          if (done.error) {
            setError(messageFor(done.error));
            return false;
          }
          return true;
        }

        const verified = await signIn.emailCode.verifyCode({ code });
        if (verified.error) {
          setError(messageFor(verified.error));
          return false;
        }
        if (signIn.status !== 'complete') {
          setError('That did not complete sign-in. Request a new code and try again.');
          return false;
        }
        const done = await signIn.finalize({ navigate: () => {} });
        if (done.error) {
          setError(messageFor(done.error));
          return false;
        }
        return true;
      } finally {
        setSubmitting(false);
      }
    },
    [flow, signIn, signUp],
  );

  const resetFlow = useCallback(async () => {
    setError(null);
    // Local-only: clears the attempt without a request, so the guard falls back
    // to the login screen. There is no session to sign out of yet.
    await Promise.all([signIn.reset(), signUp.reset()]);
  }, [signIn, signUp]);

  const busy = submitting || signInFetch === 'fetching' || signUpFetch === 'fetching';

  return useMemo(
    () => ({
      pendingVerification: flow !== null,
      flow,
      pendingEmail,
      busy,
      error,
      requestCode,
      resendCode,
      submitCode,
      resetFlow,
    }),
    [busy, error, flow, pendingEmail, requestCode, resendCode, resetFlow, submitCode],
  );
}
