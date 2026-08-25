import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ClerkProvider } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import { ThemeProvider, useTheme } from '../src/theme/ThemeProvider';
import { ChatStoreProvider, useChatStore } from '../src/store/ChatStore';
import { LaunchScreen } from '../src/components/LaunchScreen';

function Shell() {
  const { colors, scheme } = useTheme();
  const { hydrated, signedIn, emailVerified } = useChatStore();

  // Until AsyncStorage has been read we don't know which stack to show, so the
  // design's Launch Screen stands in.
  if (!hydrated) return <LaunchScreen />;

  const signedInAndVerified = signedIn && emailVerified;

  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bgPrimary },
          animation: 'default',
        }}
      >
        {/*
         * Guards, not redirects: a `router.replace` driven by an effect re-runs on
         * every segment change and can loop. expo-router evaluates these instead and
         * moves off any screen that becomes unavailable.
         */}
        <Stack.Protected guard={!signedInAndVerified}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>

        <Stack.Protected guard={signedInAndVerified}>
          <Stack.Screen name="(app)" />
          <Stack.Screen name="settings" options={{ presentation: 'modal' }} />
          <Stack.Screen name="about" options={{ presentation: 'card' }} />
          <Stack.Screen name="support" options={{ presentation: 'card' }} />
          <Stack.Screen name="archived" options={{ presentation: 'card' }} />
          <Stack.Screen name="voice" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
        </Stack.Protected>
      </Stack>
    </>
  );
}

/*
 * Passed explicitly rather than left to Clerk to read: environment variables
 * inside node_modules are not inlined during a production build, so a key the
 * SDK looks up itself resolves to undefined in a release binary.
 */
const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

export default function RootLayout() {
  if (!publishableKey) {
    throw new Error(
      'Missing EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY. Copy .env.example to .env and add ' +
        "the publishable key from the Clerk dashboard, then restart with `npx expo start --clear` " +
        '(env changes are baked in at bundle time).',
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/*
       * Outermost app provider: ChatStore reads the session off Clerk, so Clerk
       * has to be mounted above it. `tokenCache` persists the session token in
       * expo-secure-store (encrypted, unlocked after first unlock) instead of
       * memory, which is what keeps the user signed in across app launches.
       */}
      <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
        <SafeAreaProvider>
          <ThemeProvider>
            <ChatStoreProvider>
              <Shell />
            </ChatStoreProvider>
          </ThemeProvider>
        </SafeAreaProvider>
      </ClerkProvider>
    </GestureHandlerRootView>
  );
}
