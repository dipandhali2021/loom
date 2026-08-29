# Sign in with Google

Native Google sign-in — the OS account picker, not a browser. Credential Manager on
Android; `ASAuthorization` on iOS once the URL scheme is set.

The code is written and typechecks. What is left is credentials: nothing in this
repo can create them, and the button stays disabled until they exist. Work through
the numbered steps below and it lights up.

Everything here is public identifiers. The one real secret — Google's **Client
Secret** — is pasted into the Clerk Dashboard and never into this repo.

## What is already done

- `@clerk/expo-google-signin` installed, and its config plugin added to `app.json`
  alongside `@clerk/expo`.
- `app.config.ts` copies the client IDs from the environment into `expo.extra`.
  **This is the part that makes it work in an APK.** Expo inlines `EXPO_PUBLIC_*`
  into your own source but deliberately not into `node_modules`, so the
  `process.env` lookup inside `@clerk/expo` resolves to `undefined` in any bundle
  Metro is not serving. The SDK reads `Constants.expoConfig.extra` first, so the
  copy is what a release build actually finds.
- `src/auth/useGoogleAuth.ts` — the flow, shaped like `useEmailOtpAuth` so the
  login sheet drives both the same way.
- `app/(auth)/login.tsx` — the Google row is live, with a spinner while the sheet
  is up and one shared error line.
- `eas.json` with a `production-apk` profile, since you are testing from an APK.

Sign-up needs no extra work: Clerk transfers an unrecognised Google account into a
sign-up itself, and the server creates its local row on that user's first
authenticated request (`server/src/auth.ts`, `withUser`).

## 1. Clerk Dashboard — add the connection

SSO connections → **Add connection** → **For all users** → **Google**.

Turn on both **Enable for sign-up and sign-in** and **Use custom credentials**.
Production instances require custom credentials; a development instance would work
on Clerk's shared ones, but an APK you hand to testers should not.

Copy the **Authorized Redirect URI** it shows you and keep the tab open.

## 2. Google Cloud Console — create the clients

In a project of your own, under **APIs & Services → Credentials**.

You need **two** clients even though only one device signs in:

**Web application** — this is the one whose ID the app actually sends. It is the
audience Clerk verifies Google's ID token against, so it is required on Android and
iOS both. Under *Authorized redirect URIs*, paste the URI from step 1. Save the
Client ID **and** the Client Secret.

**Android** — needs your package name and a signing-certificate SHA-1:

- Package name: `com.example.loom` (`android.package` in `app.json`). Change this to
  a domain you own before shipping; if you change it, the Android client and the
  Clerk native application below both have to be recreated.
- SHA-1: see [Which SHA do I use?](#which-sha-do-i-use) — this is the step that
  most often makes a release APK fail while debug worked.

If you will also ship iOS, create an **iOS** client against the bundle identifier.

## 3. Back in Clerk — paste the web credentials

Into the connection from step 1, under *Use custom credentials*: the **web**
client's ID and secret. Save.

> Doing this from a terminal instead: write
> `{"connection_oauth_google":{"enabled":true,"client_id":"…","client_secret":"…"}}`
> to `connection.json`, run `npx clerk@latest config patch --file connection.json`,
> then delete the file. Keeps the secret out of your shell history. Do not commit it.

## 4. Clerk → Native Applications

Add the Android app: a namespace, the package name `com.example.loom`, and the
signing certificate's **SHA-256** (note: 256 here, 1 in step 2).

Native sign-in fails in production without this entry.

## 5. Fill in `.env`

```bash
EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID=…apps.googleusercontent.com
EXPO_PUBLIC_CLERK_GOOGLE_ANDROID_CLIENT_ID=…apps.googleusercontent.com
```

`.env.example` documents all four variables, iOS included.

Android's client ID is not read by the SDK at all — the credential picker resolves
the app by package name and signing certificate, which is why Clerk asked for a
fingerprint rather than an ID. It is in `.env` so the value has one home.

## 6. Build

`.env` is gitignored, so **EAS Build never sees it.** Set the same values as EAS
environment variables, or the APK will ship with an empty `extra` and the button
will be disabled with no error to explain why:

```bash
eas env:create --name EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID --value …apps.googleusercontent.com --environment production --visibility plaintext
eas env:create --name EXPO_PUBLIC_CLERK_GOOGLE_ANDROID_CLIENT_ID --value …apps.googleusercontent.com --environment production --visibility plaintext
```

Do the same for `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` and `EXPO_PUBLIC_API_URL`,
which have the same problem. Then:

```bash
eas build --profile production-apk --platform android
```

`production-apk` extends `production` but emits an installable APK instead of an
AAB. A local `npx expo run:android --variant release` works too, but it signs with
your debug keystore unless configured otherwise — so the SHA-1/SHA-256 pair from
step 2 and 4 must be the debug keystore's, not EAS's.

## Which SHA do I use?

The fingerprint identifies *the build*, not the app. An APK signed with a different
key is a different app to Google, and the picker will refuse it.

- **EAS-built** (the recommended path): EAS holds the keystore. `eas credentials`
  → Android → your profile prints both fingerprints. Use those.
- **Local debug build**: `~/.android/debug.keystore`, password `android`.
- **Local release with your own keystore**: that keystore.

```bash
keytool -keystore ~/.android/debug.keystore -list -v
```

If you test both a local debug build and an EAS release, add *both* SHA-1s to the
Android OAuth client and *both* SHA-256s to Clerk's native application. Google
accepts several fingerprints per client.

## Verifying it worked

The Google row enables itself only when the credentials resolved, so:

- **Row visibly disabled in the APK** → `extra` is empty. The EAS environment
  variables in step 6 are missing. Confirm with
  `npx expo config --type public` locally: `extra` should list the client IDs.
- **Row enabled, picker opens, nothing happens after choosing an account** →
  Clerk rejected the ID token. Usually the wrong client ID in
  `EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID` (an Android or iOS one instead of the
  web one), or the web client's credentials were never pasted into Clerk in step 3.
- **Picker refuses to open, or reports a developer error** → fingerprint mismatch.
  Re-check the SHA-1 on the Android OAuth client against the keystore that signed
  the APK you installed.
- **"native module is not available"** → the build predates
  `@clerk/expo-google-signin`. Rebuild; this cannot work over a JS-only update.

An error the flow itself reports appears under the buttons on the login sheet.
Cancelling the picker is silent, by design.

## iOS

The code path is there and `.env.example` documents both iOS variables, but it is
untested — no iOS build has been made. Two things to know before trying:

- `EXPO_PUBLIC_CLERK_GOOGLE_IOS_CLIENT_ID` is **required** on iOS; the hook refuses
  to start without it. `EXPO_PUBLIC_CLERK_GOOGLE_IOS_URL_SCHEME` is optional and
  turns a browser sheet into the native credential sheet.
- App Store guideline 4.8 requires Sign in with Apple in any iOS app offering
  another third-party social sign-in. The Apple row in the login sheet is still a
  placeholder, so that is a submission blocker — not a problem for Android.
