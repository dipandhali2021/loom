# ChatGPT iOS App UI — React Native / Expo Go

A pixel-accurate React Native implementation of the [ChatGPT iOS App UI Figma
template](https://www.figma.com/design/qdILME75coHzgHr2H5ugIp/ChatGPT-iOS-App-UI---Free-Figma-Template--Community-)
by Iosi Pratama. Every frame in the file is reproduced at its design metrics
(393 × 852), and the screens are wired together into a working app — chats
stream, state persists, the theme switches — rather than static mockups.

Runs in **Expo Go**: no custom native modules, no prebuild, no Xcode/Android
Studio required.

---

## 1. Requirements

| Tool | Version |
| --- | --- |
| Node.js | 22.13+ (Expo SDK 57 minimum) |
| npm | 10+ (ships with Node 22) |
| Expo Go | the **SDK 57** build — see below, the store build may be older |

A phone and a computer on the same Wi-Fi network. No Xcode or Android Studio
needed — those are only required if you later run a native build.

Check your Node version first, since SDK 57 will not start on older runtimes:

```bash
node --version
```

## 2. Install

```bash
cd mirai-v2
npm install --legacy-peer-deps
```

`--legacy-peer-deps` is required. `react-dom@19.2.8` (pulled in transitively by
the Expo toolchain) declares a peer range that npm's strict resolver rejects
against `react@19.2.3`; the flag lets the install proceed. It does not affect
the runtime bundle.

## 3. Run

```bash
npx expo start
```

Metro prints a QR code. Then:

- **iOS** — open Camera, scan the QR code, tap the banner to open Expo Go.
- **Android** — open Expo Go, tap *Scan QR code*, scan it.

### Get the SDK 57 build of Expo Go first

Each Expo Go build embeds exactly **one** SDK version, and it has to match the
`expo` version in `package.json` (SDK 57 here). The App Store build stops at SDK
54 and the Play Store build often lags a new release, so the store copy is
usually *not* the one you need. If Expo Go says *"Project is incompatible with
this version of Expo Go"*, that's why.

- **Android phone / emulator, iOS Simulator** — open <https://expo.dev/go>,
  pick **SDK 57** and your platform, and install that build. Or from the CLI:

  ```bash
  npx expo-go download android 57.0.0
  ```

  On a phone, sideloading the APK needs *Install unknown apps* enabled for your
  browser or file manager. Installing it replaces the store copy.

- **Physical iPhone / iPad** — the App Store has no SDK 55+ build. Use
  <https://sign.expo.dev>, pick SDK 57, and follow the steps; it signs with your
  Apple ID's free provisioning, valid ~7 days, then re-sign there again.

After installing, restart the dev server (`npx expo start`) and scan again.

If the phone can't reach your machine (VPN, corporate Wi-Fi, client isolation),
use a tunnel:

```bash
npx expo start --tunnel
```

Useful keys once Metro is running: `r` reload, `j` open debugger, `m` toggle the
dev menu, `shift+m` more tools.

## 4. What you'll see

The app boots to the animated **Launch Screen** while it reads persisted state,
then lands on **Login**. Any of the four auth buttons signs you in:

- *Continue with Apple* / *Continue with Google* — sign in immediately.
- *Sign up with email* — enter an address, which routes to **Verify your email**;
  tap *I've verified my email* to continue.
- *Log in* — signs in directly.

From the chat screen: tap a prompt chip or type a message to get a streamed
reply, the title to switch models, the ☰ icon for chat history, the headphones
icon for the voice flow, and Settings via the history drawer's footer row.

## 5. Screen map

Every Figma frame, and where it lives:

| Figma section / frame | Route or component |
| --- | --- |
| Onboarding › Launch Screen (36:668) | `src/components/LaunchScreen.tsx` |
| Onboarding › Login 1–4 (13:1130, 13:1180, 1:163, 1:189) | `app/(auth)/login.tsx` — one screen, cross-fading variants |
| Onboarding › Email Verification (36:670) | `app/(auth)/verify-email.tsx` |
| — (bridges Login → Verification) | `app/(auth)/signup.tsx` |
| MainView › Main View (13:801) | `app/(app)/index.tsx` — empty state |
| MainView › Getting answer (13:803) | same screen, streaming |
| MainView › Scrolling (1:441) | same screen, transcript + blurred nav bar |
| Settings › Selecting GPT (24:645) | `src/components/ModelPicker.tsx` |
| Settings › Settings (24:703) | `app/settings.tsx` |
| Settings › Archived Chats (row target) | `app/archived.tsx` |
| Voice Chat › Welcome (11:603) | `app/voice/index.tsx` |
| Voice Chat › Choose a voice (13:633) | `app/voice/choose.tsx` |
| Voice Chat › Talking (13:631) | `app/voice/talking.tsx` |
| Support › Support (6:4659) | `app/support.tsx` |
| Support › About (26:652) | `app/about.tsx` |

### The chat screen follows a second file

The transcript, nav bar, and composer follow the [ChatGPT Apps UI
Kit](https://www.figma.com/design/rR8Yz5BLDtLM1EKCPalwY3/ChatGPT-Apps-UI-Kit--Community-?node-id=4420-1535)
(node `4420:1535`, framed at 390 × 844) rather than the original template, which
is a generation behind. What that changes:

- Turns carry no avatar and no "You" / "ChatGPT" label. The user's message is a
  right-aligned gray capsule; the assistant's is plain body text at full width.
  Dropping those two columns is most of what removes the old layout's whitespace.
- Each finished assistant reply gets an action row — copy, read aloud, the two
  votes, regenerate, share (`src/components/MessageActions.tsx`). Copy, read
  aloud, regenerate, and share are wired; the votes are local state only.
- The composer is a single flat pill (`+` · *Ask anything* · mic · round button)
  that no longer expands and collapses. The round button cycles submit → stop →
  voice with the chat's state.
- The nav bar reads *ChatGPT 5 ›* and gains an overflow button beside the
  compose glyph. GPT-5 is now the default model and a third row in the picker.

Type on this screen is one point larger than the rest of the app (18pt body
against 17pt) with tighter leading, which is the "bigger text, less space" pair
the kit uses. Those live as `chatBody` / `chatBubble` / `navTitle` / `composer`
in `src/theme/tokens.ts`; the other screens keep the original iOS ramp.

Two things are extrapolations, because the Figma file implies them without
drawing them: the chat-history drawer (`src/components/HistoryDrawer.tsx` — the
menu button exists, the panel does not) and the email-capture step in
`app/(auth)/signup.tsx` (the design jumps straight from Login to Verification).
Both are marked as such in their file comments.

## 6. Project layout

```
app/                        expo-router routes (file = route)
  _layout.tsx               providers, auth guards, stack + presentations
  (auth)/                   login, signup, verify-email
  (app)/                    index (chat), new
  voice/                    index (welcome), choose, talking
  settings.tsx  archived.tsx  support.tsx  about.tsx
src/
  theme/tokens.ts           palette, light/dark colors, iOS type ramp, layout
  theme/ThemeProvider.tsx   system|light|dark preference, persisted
  components/               NavBar, Composer, MessageRow, MessageActions, GroupedList,
                            ModelPicker, HistoryDrawer, PromptExamples, Icon, AppText,
                            LaunchScreen
  store/ChatStore.tsx       conversations, streaming, auth, settings — persisted
  lib/reply.ts              canned assistant replies + title derivation
  lib/scale.ts              maps the design's absolute coordinates to device width
  assets/icons.ts           GENERATED — do not edit
assets/icons/               48 SVGs exported from Figma
assets/img/                 profile, buy-me-a-coffee, user avatar
scripts/gen-icons.mjs       assets/icons/*.svg -> src/assets/icons.ts
```

### Design tokens

Colors, type, and layout constants live in `src/theme/tokens.ts`, transcribed
from the design's own Figma variables — iOS semantic colors (`labels/secondary`
= `rgba(60,60,67,0.6)`, `separators/non-opaque` = `#E5E5EA`, `fills/primary` =
`rgba(120,120,128,0.36)`) plus the template's own palette. `ThemeProvider`
resolves the light/dark pair and persists the user's `system | light | dark`
choice.

Type uses the platform UI font: SF Pro on iOS via `System`, Roboto on Android.
SF Pro cannot be redistributed, so its optical weights (510 Medium, 590
Semibold) map to the nearest Android numeric weight.

### Icons

Icons are the **exported Figma vectors**, never hand-drawn. `scripts/gen-icons.mjs`
inlines `assets/icons/*.svg` into `src/assets/icons.ts` and rewrites single-ink
fills/strokes to `currentColor` so `<Icon color=… />` can theme them;
genuinely multi-color marks (Google, Doge, the OpenAI avatar, the badges) keep
their own fills.

After adding or replacing an SVG in `assets/icons/`:

```bash
node scripts/gen-icons.mjs
```

If a new icon should be themeable, add its filename to the `MONO` set at the top
of that script before regenerating.

The chat screen's action row and composer also draw on **Feather** and
**MaterialIcons** from `@expo/vector-icons`, for glyphs the original template
never exported (thumbs up/down, share, the waveform). Their outlines match the
kit's stroke weight. Everything the template *does* export still comes from
`assets/icons/` — no icon anywhere is hand-drawn.

## 7. Behavior notes

**Replies are simulated.** There is no API key and no network call. `src/lib/reply.ts`
holds canned answers matched to the design's own sample prompts, and
`ChatStore` streams them at 3 characters per 28 ms. That's what makes the
Typing / Getting-answer / Scrolling states reachable. To use a real model,
replace the `generateReply` call inside `sendMessage`
(`src/store/ChatStore.tsx`) with a request to your backend and push each chunk
through the same `patchConversation` update the interval already uses — nothing
above that function needs to change.

**Code blocks can run.** A fence in a language the sandbox supports gets a Run
pill; pressing it executes the code in a throwaway Firecracker microVM on Deno
Deploy and shows stdout, stderr, the exit code and the elapsed time. Python, C,
C++, Java, TypeScript/JavaScript and shell are wired. It is optional and off
until a token is configured — setup and architecture are in
[`server/SANDBOX.md`](server/SANDBOX.md).

**The action row does real work.** Copy uses `expo-clipboard`, read aloud uses
`expo-speech`, share uses React Native's `Share`, and regenerate re-streams the
reply through the same `startStream` helper `sendMessage` uses
(`src/store/ChatStore.tsx`). The thumbs are local component state — there is no
backend to send a rating to.

**Voice is UI-only.** The Talking screen animates the design's shapes; it does
not record audio (`expo-av`/`expo-speech` would be the next step, and neither is
needed for the design).

**Persistence.** Conversations, model, voice, haptics, and auth state are stored
in AsyncStorage under `chatgpt-clone/state-v1`; the theme preference under
`chatgpt-clone/color-scheme`. To reset, delete and reinstall the app in Expo Go,
or clear its data.

## 8. Verify

```bash
npx tsc --noEmit     # types
npx expo-doctor      # config + dependency health (21/21 should pass)
npx expo export --platform all --output-dir /tmp/check && rm -rf /tmp/check
```

All three pass on this tree.

## 9. Troubleshooting

**`Unable to resolve module react-native-worklets`** — Reanimated 4 requires it
as a peer. `npm install react-native-worklets@0.10.1 --legacy-peer-deps`.

**`Cannot find module 'babel-preset-expo'`** — it must be a direct dependency,
not just hoisted under `expo/`. It's in `devDependencies`; re-run the install.

**Do not add `react-native-worklets/plugin` to `babel.config.js`.**
`babel-preset-expo` adds it automatically when the package is installed; listing
it twice breaks the transform.

**Stale bundle after dependency changes** — `npx expo start --clear`.

**`Project is incompatible with this version of Expo Go`** — your Expo Go is a
different SDK than this project (SDK 57). Updating from the store usually does
*not* fix it: the App Store build stops at SDK 54 and the Play Store build lags.
Install the SDK 57 build from <https://expo.dev/go> (Android/emulators/iOS
Simulator) or <https://sign.expo.dev> (physical iOS), then `npx expo start`
again. See *Get the SDK 57 build of Expo Go first* in section 3.

## 10. Native builds (optional)

Expo Go covers everything here. If you want a standalone app:

```bash
npm install --global eas-cli
eas login
eas build --profile preview --platform ios      # or android
```

Change `ios.bundleIdentifier` / `android.package` in `app.json` from
`com.example.chatgptclone` first.

## 11. Credits and license

UI design: **Iosi Pratama** — [posts.CV](https://posts.cv/iosipratama) ·
[x.com/iosipratama](https://x.com/iosipratama) ·
[Buy Me A Coffee](https://buymeacoffee.com/iosipratama).

The template's own terms, reproduced on the in-app About screen: personal and
educational use only; do not resell or redistribute. ChatGPT and the OpenAI mark
belong to OpenAI — this is a UI study, not affiliated with or endorsed by OpenAI.
