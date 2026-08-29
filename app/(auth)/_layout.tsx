import React from 'react';
import { Stack } from 'expo-router';

/** Without an index route, `/` belongs to (app) alone, so it resolves unambiguously. */
export const unstable_settings = { anchor: 'login' };

/**
 * One screen. Email entry and code entry used to be routes of their own, guarded
 * on the auth flags; they are steps inside the login sheet now, so the whole
 * group is a single screen and the root layout's guard is the only one needed --
 * a second guard here could only unmount login while its flow is still running.
 */
export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
      <Stack.Screen name="login" />
    </Stack>
  );
}
