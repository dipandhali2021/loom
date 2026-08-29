# Login: one OTP flow, one route, a video hero

## Why

The login screen had four buttons where one would do, and two of them ("Sign up
with email", "Log in") led to the same place: `requestCode` already tries a
sign-in and falls back to a sign-up, so the address decides which happens.
Asking the user to choose first was busywork, and a wrong guess sent them to a
screen labelled for the other case.

Behind them sat three routes -- `login`, `signup`, `verify-email` -- advanced by
auth-flag guards rather than navigation. That worked, but it means the screen is
replaced twice on the way in, which is incompatible with a background that has
to keep playing.

The backdrop was four flat colours on a 2.6s timer. It is now the user's own
footage.

## What changed

### One route

`app/(auth)/login.tsx` is the only auth screen. Its sheet morphs in place:

    choices -> email -> code -> (signed in, root guard swaps the stack)

`signup.tsx` and `verify-email.tsx` are deleted; their field, copy, auto-submit
and resend behaviour moved into the sheet unchanged. `(auth)/_layout.tsx` is a
one-screen `Stack` with no guards of its own.

Which step shows is derived, not stored:

    pendingVerification ? 'code' : emailOpen ? 'email' : 'choices'

`pendingVerification` comes off Clerk's live resources, so a remount mid-flow
lands back on the step the real attempt is at. Only the tap that opens the email
field is local state.

### The auth flags

`ChatStore` used to report:

    signedIn: !!isSignedIn || pendingVerification
    emailVerified: !!isSignedIn

`signedIn` was true for a user with no session, which is what let the `(auth)`
guard swap `login` out for `verify-email` the moment a code was sent. With the
flow in one sheet that same behaviour would unmount the screen -- and tear down
its video -- mid-flow.

`emailVerified` is gone and `signedIn` is now `!!isSignedIn`. The root layout's
gate was `signedIn && emailVerified`, which expanded to
`(isSignedIn || pending) && isSignedIn` -- plain `isSignedIn` -- so root
behaviour is unchanged by construction. The two-flag split existed only to drive
the two-step routing that has been deleted.

### The hero

`src/hero/` holds three files:

- `clips.ts` -- the manifest. Adding a clip is one `require()` line. Local
  `require` rather than a remote URL: the hero is the first thing the app draws,
  and a login screen that needs the network to paint its own background is a
  worse first launch.
- `HeroScrim.tsx` -- a flat black layer at 0.78 (video reads at ~22%) under a
  bottom-to-top gradient. Eight smoothstep-sampled stops, the same shape
  `TopFade` uses: a two-stop ramp bands on a dark screen and its midpoint reads
  as a hard edge. Drawn with `react-native-svg`, already a dependency, so
  `expo-linear-gradient` is not installed.
- `HeroVideo.tsx` -- two `VideoPlayer`s cross-fading on `playToEnd` with a
  shared Ken Burns drift (1.0 -> 1.06 over clip + fade).

Two players and two views, not one of each: mounting two views against a single
player does not work on Android (expo#35012), and a dissolve needs the outgoing
frame present while the incoming one rises. They alternate, and whichever just
went dark loads the clip after next once its fade finishes -- so a manifest of
any length rotates through the same two players, and the incoming clip has been
buffering for a full cycle before it is shown.

`surfaceType="textureView"` is required, not stylistic: two overlapping `cover`
views render out of bounds on a SurfaceView (androidx/media#1107).

Black lives only on the root view. A background on the fading layers would
darken the outgoing clip through the incoming one, so the dissolve is video over
video with the fill behind both.

`loop` is off, because a looping player never emits `playToEnd`. A one-clip
manifest is handled by replaying in place. Returning from the background calls
`play()` on the front player -- a paused clip never reaches its end, so without
that the rotation would stop permanently rather than for as long as the app was
away.

The wordmark stays in the screen. `HeroVideo` exposes `onBeat`, a plain
notification with no clip index: the screen has its own number of phrases, and
passing an index would cap the rotation at the manifest's length. The phrase
swaps at the bottom of its own fade, where there is nothing to see.

### Buttons

One email row. Apple only on iOS -- it is the platform's own account, and
offering it on Android promises something the device cannot do -- Google on
both. Both social rows stay inert placeholders with
`accessibilityHint="Not available yet. Use email instead."`; OAuth wiring is a
separate change.

### Reading Clerk's failures, and its state

Two runtime bugs, both from trusting one source too far.

`requestCode` switched on `attempt.error.code`. An API failure resolves as a
`ClerkAPIResponseError`, whose own `code` is always the literal
`'api_response_error'`; the per-field codes live one level down in `errors[]`.
So `code !== 'form_identifier_not_found'` was true even for an address Clerk had
never seen, the sign-up fallback never ran, and a new user was told their account
could not be found. A `hasCode` helper now checks `errors[]` first and the outer
code second -- second because a `ClerkRuntimeError` (offline, aborted) has no
`errors` and carries its real code at the top. `messageFor` prefers the nested
`longMessage` for the same reason: Clerk documents the outer message as
developer-facing and unstable.

The step was derived from Clerk's live resources alone, and `signUpPending`
required `missingFields.length === 0`. Anything left in `missingFields` -- a
"Password" toggle in the Clerk dashboard is enough -- left every flag false while
a real code sat in the user's inbox, so the sheet stayed on the email field as
though nothing had been sent. That condition is gone (what it actually blocks is
`finalize()`, which reports it as its own error), and a successful send is now
also recorded locally and OR-ed with the derived flags. The derived flags still
lead, because they survive a remount; the local echo means that whatever shape
Clerk's resource takes, a code that went out moves the screen on. `resetFlow`
clears it.

### The sheet, and the keyboard

The sheet is grey (`fillQuaternary`, `#1E1E1E`) rather than black. The scrim
reaches black at the bottom of the screen, so a black sheet was not a surface at
all -- its rounded top was invisible and the buttons read as floating on the
video. Its hairline and the two field borders moved from `separatorNonOpaque`
(`#2A2A2A`) to `separatorOpaque`, which `#2A2A2A` could not be seen against.

The keyboard is measured, not delegated. There was a `KeyboardAvoidingView` with
`behavior={Platform.OS === 'ios' ? 'padding' : undefined}` -- i.e. no Android
behaviour at all -- and the keyboard covered the sheet. Its Android options both
cost something: `height` shrinks the container the sheet is anchored inside, and
`padding` mis-measures under edge-to-edge. So the screen listens the way
`ModelSheet` does: `keyboardWillShow`/`Hide` on iOS, `keyboardDidShow`/`Hide` on
Android, frames under `KEYBOARD_MIN_HEIGHT` (120) rejected as a hardware
keyboard's accessory bar, `event.duration` where iOS reports it and 260ms where
Android does not.

The lift is a `translateY` on a wrapper view, not padding on the sheet. The sheet
already carries a `LinearTransition` for the step morph, and opening the email
step changes the step *and* focuses a field in the same frame -- moving it by
layout would put two animations on the same property at once. It travels the
keyboard's full height, which lands the sheet's bottom edge on the top of the
keyboard: the sheet's own bottom padding is then the standoff to the keys, and no
strip of video can open up underneath.

The wordmark then gets out of the way of the sheet, which otherwise covered its
lower half. Both boxes are measured -- the sheet's height changes with the step,
the wordmark's with the phrase -- and the overlap between the sheet's lifted top
edge and the bottom of the wordmark is what the wordmark gives back, capped below
the status bar so it cannot be pushed off screen. Nothing moves until the sheet
actually reaches it. The sheet's height is held in a shared value rather than
React state, because the offset depends on that and on the keyboard at once and
the two arrive from different places: React commits the height, the keyboard
listener writes the lift. It eases over the morph's own duration so the wordmark
drifts with the growing sheet instead of jumping a step ahead of it.

### The clips

`scripts/encode-hero.sh <source> <out-name> [start-seconds]` centre-crops to
9:19.5, trims 6s, strips audio, and writes faststart H.264 at CRF 26.

| Clip | Source | Start | Native | Crop | Encoded | Size |
|---|---|---|---|---|---|---|
| `hero-01` | `04bce…` | 0s | 3416x2428 | 1120x2428 | 1080x2340 | 1.4MB |
| `hero-02` | `78d67…` | 0s | 1920x1080 | 498x1080 | 498x1078 | 316KB |
| `hero-03` | `enhanced…` | 0s | 3424x2424 | 1118x2424 | 1080x2340 | 2.1MB |
| `hero-04` | `enhanced…` | 2s | 3424x2424 | 1118x2424 | 1080x2340 | 2.2MB |
| `hero-05` | `enhanced…` | 4s | 3424x2424 | 1118x2424 | 1080x2340 | 2.1MB |

7.9MB of clips in all. `hero-03`/`04`/`05` share one 10.04s source, so their
starts are 0/2/4 rather than 0/3/6: the script trims 6s from `start`, and a 6s
start on a 10.04s source yields a 4.04s clip. `CLIP_SECONDS` is what the Ken
Burns drift is timed against, so a short clip would leave the push stalled at
`DRIFT_TO` for the remainder. Every clip here is exactly 6.000000s.

`hero-01` is committed but commented out of the manifest, so four clips are in
rotation. Uncommenting the line is the whole of putting it back.

`expo-video` is `~57.0.3`. `npx expo install` added its config plugin to
`app.json`, so a dev client has to be rebuilt before the hero draws.

`hero-02` is not 1080 wide on purpose. A 9:19.5 window on a 1080p landscape
source contains only ~498px of real width; scaling that to 1080 bakes in a 2.2x
upscale and pays file size for blur. The script never upscales, so outputs are
capped at 1080 wide but keep their own size below it. Every clip shares the
aspect ratio, so `contentFit="cover"` treats them identically and the GPU does
the rest at draw time.

Encoded clips are committed -- `require()` resolves at build time, so they have
to be in the repo. The three sources (127MB, 6.7MB, 39MB) are gitignored; the
script regenerates the clips from them.

## Verified

- `tsc --noEmit` clean.
- `expo export` bundles for both iOS and Android, with the clips in the asset
  manifest. That run predates `hero-03`/`04`/`05`, so it covered the first two;
  the three added since are byte-identical in shape to `hero-01`, which it did
  cover.
- `ffprobe` on all five clips: 6.000000s each, and 1080x2340 for every clip that
  had the width to reach it.
- ESLint: the six remaining errors in these files are `react-hooks/immutability`
  on `sharedValue.value` writes, which every existing reanimated component in
  the repo also reports (57 across the tree before this change). No new class of
  finding.
- On device, before the fixes above: a code does reach a brand-new address, but
  the not-found error surfaced and the sheet never advanced to the code step. The
  two fixes in "Reading Clerk's failures" address exactly those two reports; that
  they work is not yet confirmed on device.

The cross-fade and the Android surface workaround are not verified here -- they
need a device or simulator. Nor is the keyboard lift, on either platform.

## Not done

- OAuth for Apple/Google. The rows are placeholders by decision.
- No automated tests: the repo has no test runner, and what changed is native
  playback and layout.
