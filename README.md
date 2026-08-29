# Loom

A chat app for talking to AI models, built with React Native and Expo. A
conversation is a thread: you write, a reply streams back, and the thread is kept
so you can pick it up later.

Two halves, both in this repo:

- the Expo app (`app/`, `src/`)
- an Express + Prisma + Postgres API (`server/`), which exists so that no model
  API key is ever in the client bundle

---

## 1. Requirements

| Tool | Version |
| --- | --- |
| Node.js | 22.13+ (Expo SDK 57 minimum) |
| npm | 10+ (ships with Node 22) |
| Postgres | any 14+; the project was built against Neon |

A Clerk application for authentication, and an OpenAI-compatible endpoint for the
models. Web search, attachments, dictation and code execution are each optional
and off until configured.

Check your Node version first, since SDK 57 will not start on older runtimes:

```bash
node --version
```

### This project needs a dev client, not Expo Go

`expo-video` ships a config plugin, so the login screen's video hero cannot run in
Expo Go. Build a development client once and use that instead:

```bash
npx expo run:android      # or: npx expo run:ios
```

That needs Android Studio or Xcode installed. Alternatively build it in the cloud
with `eas build --profile development`. After the first build, `npx expo start`
and the dev client behave exactly like Expo Go did.

## 2. Install

```bash
npm install --legacy-peer-deps
cd server && npm install && cd ..
```

`--legacy-peer-deps` is required for the app. `react-dom@19.2.8` (pulled in
transitively by the Expo toolchain) declares a peer range that npm's strict
resolver rejects against `react@19.2.3`; the flag lets the install proceed. It
does not affect the runtime bundle.

## 3. Configure

Two env files, one per half. Both have a committed `.example`.

```bash
cp .env.example .env
cp server/.env.example server/.env
```

The app needs two values to run at all: the Clerk publishable key (public by
design, inlined into the bundle) and the URL of the API. The four Google
client-ID variables below them are optional — without them the Google sign-in row
is disabled and email still works. A physical device cannot reach
`localhost` — that resolves to the phone itself — so use your machine's LAN
address, `10.0.2.2` on an Android emulator, or `localhost` on the iOS simulator.

The server needs the database URL, the Clerk secret key, and the model endpoint's
base URL and key. Everything else in `server/.env.example` is optional and
documented inline.

Env changes are baked in at bundle time, so restart with `npx expo start --clear`
after editing `.env`.

## 4. Run

```bash
cd server && npm run dev     # API on :3000
npx expo start               # Metro, in another terminal
```

Metro prints a QR code; open it in the dev client. Useful keys once it is running:
`r` reload, `j` open debugger, `m` toggle the dev menu, `shift+m` more tools.

If the phone cannot reach your machine (VPN, corporate Wi-Fi, client isolation),
use a tunnel: `npx expo start --tunnel`.

## 5. What you'll see

The app boots to the animated launch screen while it reads persisted state, then
lands on **Login** — a video hero behind a sheet that morphs in place:

    choices -> email -> code -> signed in

Enter an email address and a six-digit code arrives; whether the account already
exists decides whether that is a sign-in or a sign-up, so there is nothing to
choose first. Continue with Google goes through the OS account picker instead, and
needs credentials — see [`docs/GOOGLE_SIGN_IN.md`](docs/GOOGLE_SIGN_IN.md); the row
disables itself where they are absent. The Apple row is still a placeholder.

From the chat screen: type a message for a streamed reply, pick the model in the
composer, the ☰ icon for chat history, the headphones icon for the voice flow,
and Settings from the drawer's footer row.

## 6. Project layout

```
app.json                    static app config
app.config.ts               adds the Google client IDs to `extra` at build time
eas.json                    EAS Build profiles (production-apk emits an APK)
app/                        expo-router routes (file = route)
  _layout.tsx               providers, auth guards, stack + presentations
  (auth)/login.tsx          the whole auth flow, one morphing sheet
  (app)/                    index (chat), new
  voice/                    index (welcome), choose, talking
  settings.tsx  archived.tsx
  support.tsx               Help Center
  terms.tsx  privacy.tsx  about.tsx
src/
  hero/                     login background: clips manifest, video, scrim, phrases
  auth/useEmailOtpAuth.ts   Clerk email-code flow
  auth/useGoogleAuth.ts     native Sign in with Google
  theme/tokens.ts           palette, light/dark colors, iOS type ramp, layout
  theme/ThemeProvider.tsx   system|light|dark preference, persisted
  components/               NavBar, Composer, MessageRow, Markdown, CodeBlock,
                            ModelSheet, HistoryDrawer, DocScreen, Icon, AppText, …
  store/ChatStore.tsx       conversations, streaming, auth, settings — persisted
  lib/api.ts                the server client
  lib/scale.ts              maps the design's absolute coordinates to device width
  assets/icons.ts           GENERATED — do not edit
assets/icons/               50 SVGs
assets/videos/hero/         encoded hero clips (committed)
scripts/gen-icons.mjs       assets/icons/*.svg -> src/assets/icons.ts
scripts/encode-hero.sh      source video -> a 9:19.5 hero clip
server/                     the API; see server/README.md
```

### Design tokens

Colors, type, and layout constants live in `src/theme/tokens.ts` — iOS semantic
colors (`labels/secondary` = `rgba(60,60,67,0.6)`, `separators/non-opaque` =
`#E5E5EA`, `fills/primary` = `rgba(120,120,128,0.36)`) plus the app's own palette.
`ThemeProvider` resolves the light/dark pair and persists the user's
`system | light | dark` choice.

Type uses the platform UI font: SF Pro on iOS via `System`, Roboto on Android. SF
Pro cannot be redistributed, so its optical weights (510 Medium, 590 Semibold) map
to the nearest Android numeric weight.

### Icons

Icons are SVGs in `assets/icons/`, never hand-drawn in JSX. `scripts/gen-icons.mjs`
inlines them into `src/assets/icons.ts` and rewrites single-ink fills and strokes
to `currentColor` so `<Icon color=… />` can theme them; genuinely multi-color
marks keep their own fills.

```bash
node scripts/gen-icons.mjs
```

If a new icon should be themeable, add its filename to the `MONO` set at the top
of that script before regenerating. Provider marks in the model picker are a
separate path — fetched from a CDN at runtime (`src/lib/modelIcon.ts`) rather than
bundled, because the icon package is one 3.6MB barrel that Metro will not
tree-shake.

The chat screen's action row and composer also draw on Feather and MaterialIcons
from `@expo/vector-icons` for a few glyphs the icon set never included.

### The login hero

`scripts/encode-hero.sh <source> <out-name> [start-seconds]` centre-crops a video
to 9:19.5, trims 6s, strips audio, and writes faststart H.264 at CRF 26. Add the
result to `src/hero/clips.ts` and it joins the rotation.

The script never upscales: a 9:19.5 window on a 1080p landscape source has only
~498px of real width, and stretching that to 1080 bakes in blur and pays file size
for it. Outputs are capped at 1080 wide but keep their own size below it, and
`contentFit="cover"` treats them all the same at draw time.

Encoded clips are committed — `require()` resolves at build time — while the large
sources are gitignored.

## 7. Behavior notes

**Replies are real.** The app posts to `server/`, which proxies an
OpenAI-compatible endpoint and streams the reply back over SSE. The model list is
read from that endpoint at runtime, so enabling a model upstream is the whole of
the work; nothing in the app or the server names one.

**Temporary chats are not stored.** No rows on the server, nothing in
AsyncStorage. They live in memory until the screen closes.

**Web search is per-message and off by default.** With it on, the reply's sources
are listed underneath it.

**Attachments** go through an upload pipeline (Transloadit) which re-encodes images
and renders document pages; the server keeps only URLs and extracted text, never
the file.

**Code blocks can run.** A fence in a supported language gets a Run pill, executed
in a throwaway Firecracker microVM on Deno Deploy with egress blocked. Python, C,
C++, Java, TypeScript/JavaScript and shell are wired. Optional and off until a
token is configured — see [`server/SANDBOX.md`](server/SANDBOX.md).

**Dictation** records from the composer's mic and transcribes server-side; the clip
is never stored. Voice *mode* (the full-screen flow) is UI only — it animates but
does not hold a conversation.

**Persistence.** Conversations, model, voice, haptics and archived chats live in
AsyncStorage under `loom/state-v1`; the theme preference under
`loom/color-scheme`. Both read the pre-rename keys once if the current one is
empty, so an existing install keeps its data. Clerk owns the session, in
expo-secure-store.

## 8. Verify

```bash
npx tsc --noEmit                    # app types
cd server && npm run typecheck      # server types
npx expo-doctor                     # config + dependency health
npx expo export --platform all --output-dir /tmp/check && rm -rf /tmp/check
```

## 9. Troubleshooting

**`Unable to resolve module react-native-worklets`** — Reanimated 4 requires it as
a peer. `npm install react-native-worklets@0.10.1 --legacy-peer-deps`.

**`Cannot find module 'babel-preset-expo'`** — it must be a direct dependency, not
just hoisted under `expo/`. It's in `devDependencies`; re-run the install.

**Do not add `react-native-worklets/plugin` to `babel.config.js`.**
`babel-preset-expo` adds it automatically when the package is installed; listing it
twice breaks the transform.

**The hero is black, or the app crashes on the login screen** — `expo-video` needs
a dev client. Rebuild with `npx expo run:android` / `run:ios` after any change to
`app.json`'s plugins.

**Stale bundle after dependency changes** — `npx expo start --clear`.

**The app cannot reach the API** — `EXPO_PUBLIC_API_URL` must be an address the
device can route to, and env changes need `--clear` to take effect.

## 10. Native builds

```bash
npm install --global eas-cli
eas login
eas build --profile production-apk --platform android    # installable APK
eas build --profile production --platform android        # AAB, for Play
```

`eas.json` has `development`, `preview`, `production` and `production-apk`.

`.env` is gitignored, so EAS Build never uploads it. Anything the app reads from
`process.env` has to exist as an EAS environment variable too, or the build will
ship with it empty:

```bash
eas env:create --name EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY --value pk_… --environment production --visibility plaintext
eas env:create --name EXPO_PUBLIC_API_URL --value https://… --environment production --visibility plaintext
```

`ios.bundleIdentifier` and `android.package` in `app.json` are
`com.example.loom` — change them to a domain you own before submitting anywhere.
Changing the Android package invalidates the Google OAuth client and Clerk's
native-application entry, both of which are keyed on it.

## 11. Legal

Terms of Use and the Privacy Policy are in the app, at `app/terms.tsx` and
`app/privacy.tsx`. Both carry `[Operator name]` and a placeholder support address
that a real deployment has to fill in, and the privacy policy names the processors
the code actually calls — keep it in step with the dependencies.

Replies are generated by third-party models and can be wrong. Nothing the app
produces is professional advice.
