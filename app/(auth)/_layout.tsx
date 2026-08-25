import React from 'react';
import { Stack } from 'expo-router';
import { useChatStore } from '../../src/store/ChatStore';

/** Without an index route, `/` belongs to (app) alone, so it resolves unambiguously. */
export const unstable_settings = { anchor: 'login' };

export default function AuthLayout() {
  const { signedIn, emailVerified } = useChatStore();

  // Guards rather than redirects: signing in flips these, and expo-router moves
  // off a screen that has just become unavailable.
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="login" />
        <Stack.Screen name="signup" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && !emailVerified}>
        <Stack.Screen name="verify-email" />
      </Stack.Protected>
    </Stack>
  );
}
