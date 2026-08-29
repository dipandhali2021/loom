import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Dynamic half of the app config. `app.json` is still the source of truth for
 * everything static -- Expo reads it first and hands it to this function as
 * `config` -- and this file only adds the values that have to come from the
 * environment at build time.
 *
 * Why any of this is needed: Clerk's native Google hook resolves its client IDs
 * from `Constants.expoConfig.extra` first and `process.env` second, and the
 * second path does not exist in a release build. Expo inlines `EXPO_PUBLIC_*`
 * into your own source, but deliberately not into `node_modules`, so the
 * `process.env` read inside `@clerk/expo` is `undefined` in any bundle that is
 * not being served by a running Metro. Copying the values into `extra` here is
 * what makes Sign in with Google work in an APK rather than only in dev.
 *
 * `@clerk/expo-google-signin`'s own config plugin reads the iOS URL scheme from
 * `extra` too, and plugins run after this returns, so it picks these up.
 */

/** Kept out of `extra` when unset, so a missing value reads as absent rather than as the string "undefined". */
function defined(entries: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(entries).filter(([, value]) => !!value)) as Record<string, string>;
}

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...(config as ExpoConfig),
  extra: {
    ...config.extra,
    ...defined({
      // Required on every platform. This is the *web* client ID, even for a
      // native build: it is the audience Clerk verifies the Google ID token
      // against, not the client the device signs in with.
      EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID: process.env.EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID,
      // iOS only, and required there: the hook refuses to start without it.
      EXPO_PUBLIC_CLERK_GOOGLE_IOS_CLIENT_ID: process.env.EXPO_PUBLIC_CLERK_GOOGLE_IOS_CLIENT_ID,
      // iOS only, optional: with it the OS credential sheet handles the flow;
      // without it iOS falls back to a browser sheet. The plugin turns this into
      // a CFBundleURLTypes entry.
      EXPO_PUBLIC_CLERK_GOOGLE_IOS_URL_SCHEME: process.env.EXPO_PUBLIC_CLERK_GOOGLE_IOS_URL_SCHEME,
      // Android's client ID is not read by the SDK at all -- the credential
      // picker resolves the app by package name and signing certificate, which
      // is why the Clerk dashboard wants a SHA-256 rather than an ID. It is
      // carried here only so the value has one home.
      EXPO_PUBLIC_CLERK_GOOGLE_ANDROID_CLIENT_ID: process.env.EXPO_PUBLIC_CLERK_GOOGLE_ANDROID_CLIENT_ID,
    }),
  },
});
