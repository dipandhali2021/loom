# Dynamic model catalog, and a composer that owns the model

Date: 2026-08-27

## Problem

Adding a model to the app requires a code change and a redeploy today. The app
sends one of three tiers — `'gpt-3.5' | 'gpt-4' | 'gpt-5'` — and the server maps
each to a provider model id through `env.ts:aiModels`, fed by `AI_MODEL_FAST`,
`AI_MODEL_BALANCED` and `AI_MODEL_SMART`. Three tiers, three env vars, a
hardcoded TypeScript union, and a picker with three literal rows.

The proxy (9router) already knows what is available. Enabling a model there
should be enough: the app should list what the proxy lists, and nothing else.

## What the proxy actually returns

Verified against the live endpoint on 2026-08-27, not assumed:

```json
{ "id": "qwen-3.7-max-combo", "object": "model", "owned_by": "combo" }
```

Every other entry is `owned_by: "ag"` and carries a full `capabilities` object
(`vision`, `audioInput`, `pdf`, `tools`, `reasoning`, `contextWindow`, …) plus
`context_length` and `max_completion_tokens`. A combo carries **none** of that:
three fields and no more.

Three consequences follow, and each one settles a design question:

- **`owned_by: "combo"` is a real discriminator**, alongside the `-combo` id
  suffix. Both are free; match on either, so neither changing alone breaks the
  filter.
- **There is nothing to gate attachments on.** A combo reports no `vision` flag,
  so the app cannot ask whether one accepts images. Attachments are always
  enabled; 9router's Vision Adapter handles the routing upstream.
- **The strategy is invisible.** Fallback / Round Robin / Fusion never appear in
  the payload. It stays a server-side concern and the app never surfaces it.

There is no combo-specific listing to fetch. `/v1/models?type=combo` returns 200
and silently ignores the filter; `/v1/combos` 404s with dashboard HTML;
`/v1/models/combo` 404s with `Unknown model kind: combo`. The suffix and
`owned_by` are all there is.

## Design

Two halves. The server learns the catalog; the client moves the model out of the
nav bar and into the composer.

### 1. Server: the catalog

**`server/src/models.ts`** (new) — the single source of truth.

- `fetchCatalog()` GETs `${AI_BASE_URL}/models` with `AI_API_KEY`, parses
  leniently (unknown fields ignored, so a proxy-side change cannot break boot),
  and keeps entries where `owned_by === 'combo' || id.endsWith('-combo')`.
- In-memory cache, ~5 minute TTL, **stale-on-error**: a failed refresh keeps
  serving the previous list. An upstream blip must not empty everyone's picker.
- `label` is derived from the id with no lookup table: drop any `provider/`
  prefix, strip the `-combo` suffix, split on `-`, title-case words, leave
  version tokens alone. `qwen-3.7-max-combo` → `Qwen 3.7 Max`. A model enabled
  upstream tomorrow gets a correct label with no code change, which is the whole
  point.
- `defaultModel()` returns `AI_MODEL_DEFAULT` when it is actually in the
  catalog; otherwise it logs loudly and returns the first combo, so a typo
  degrades instead of bricking every send.
- `resolveModel(id)` returns the id when present, else throws
  `HttpError(400, 'unknown_model')`.

**`GET /api/v1/models`** (new, mounted in `server/src/routes/index.ts` behind
the same `requireAuth, withUser`) returns:

```json
{ "models": [{ "id": "qwen-3.7-max-combo", "label": "Qwen 3.7 Max" }],
  "defaultModel": "qwen-3.7-max-combo" }
```

No `capabilities` field. Shipping one that is always empty is dead weight.

**Why server-proxied and not called from the app.** Hitting `/models` on the
proxy directly would require `AI_API_KEY` in the client bundle, where it is
extractable from any installed build. The key stays server-only, alongside
`CLERK_SECRET_KEY` and `TRANSLOADIT_SECRET`.

**`server/src/env.ts`** — `AI_MODEL_FAST`, `AI_MODEL_BALANCED` and
`AI_MODEL_SMART` collapse into one `AI_MODEL_DEFAULT`. `aiModels`, `AppModelId`
and `appModelIds` are deleted outright: that indirection layer is precisely what
made a new model a code change. `server/.env.example` follows.

**`server/src/routes/completions.ts`** and **`temporary.ts`** — `model` becomes
`z.string().optional()`, resolved through `resolveModel`. **This must run before
`openStream(res)`.** Once headers are out an error can only be reported in-band
as an SSE `{type:'error'}` frame; validating first keeps an unknown model a
clean JSON 400. `server/src/ai.ts` takes `model: string` already and needs no
change.

### 2. Client: catalog-driven, composer-owned

**`src/store/types.ts`** — `ModelId` becomes `type ModelId = string`. An alias
rather than a rename, so the ~15 call sites do not churn.

**`src/lib/api.ts`** — gains `listModels()`, using the existing `request<T>()`
helper.

**`src/store/ChatStore.tsx`** — gains `models` and `modelsLoaded`, fetched once
auth is ready. Persisted `model` becomes `string | null`. When the catalog
arrives, a `model` that is null **or absent from the catalog** is replaced with
`defaultModel`. That one rule migrates every existing install off its stale
`'gpt-5'` for free, with no migration code, and equally handles a combo deleted
upstream.

**`src/lib/modelIcon.ts`** (new) — id → lobehub icon slug, and the mark that
renders it.

- Slug: first token before `-`, through a small alias table
  (`gpt|o1|o3|o4 → openai`, `sonnet|opus|haiku → claude`, `glm → zhipu`,
  `qwq → qwen`), falling through to the raw token. A provider whose combo id
  starts with its own name needs no table entry — so a new provider is still
  zero-code-change; the table only patches the cases where a family name
  differs from the brand.
- Fetched from the lobehub static CDN rather than bundled.
  `@lobehub/icons-rn` is a single 3.6MB barrel with no subpath exports, and
  Metro does not tree-shake it reliably, so importing `ModelIcon` would cost
  most of that in the bundle plus an `expo-linear-gradient` peer dependency. A
  URL per slug costs nothing.
- **Rendered with `react-native-svg`, not `expo-image`.** The SDK 57 image docs
  warn that iOS's system SVG decoder mishandles elliptical arcs with packed
  large-arc/sweep flags — the form every SVG minifier emits — and recommend
  `react-native-svg` for those paths. Lobehub's files are minified that way:
  `qwen-color.svg` contains one such arc, `openai.svg` four,
  `gemini-color.svg` eight. `react-native-svg@15.15.4` is already a dependency
  and its `SvgXml` renders them correctly.
- `-color` is not universal: `qwen-color`, `claude-color`, `gemini-color`,
  `deepseek-color` and `mistral-color` are 200, while `openai-color` and
  `grok-color` are 404 — those ship mono only. So try `<slug>-color.svg`, fall
  back to `<slug>.svg`, then to the lettered circle.
- Fetched SVG text is cached in AsyncStorage keyed by slug, which makes a
  seen-once icon render offline.
- `ProviderMark` renders the cached SVG, or a lettered circle on any miss — an
  unrecognised provider, a cold offline launch, or an in-flight fetch. The
  monogram follows `Favicon.tsx`'s existing treatment, so there is one visual
  language for "a mark we could not fetch" rather than two.

**`src/components/Composer.tsx`** — the model moves here, because the model is a
property of the message being written and not of the screen.

- **Collapsed is unchanged**: `＋`, the field, the mic, and the round trailing
  button, on one row, exactly as it ships today.
- **Focus expands it**: the text moves to the top and a control row appears
  beneath, holding `＋`, the web-search globe, the model chip, the mic and the
  round button. The pill's radius relaxes from `layout.composerRadius` (28) to
  24 — a capsule stops reading as a capsule once it is two rows tall, and the
  curve eats the outer controls' corners.
- **Collapses on blur only when empty.** A draft or a pending attachment keeps
  it open, so you can still see what you are about to send and which model will
  send it. This mirrors how the trailing button already keys off draft state.
- **The model chip** is mark + full derived label + chevron — `◈ Qwen 3.7 Max ⌄`.
- **The globe becomes the real toggle**: tap to arm, tap to disarm, filled while
  armed. It is no longer only an indicator.

**`src/components/AttachmentSheet.tsx`** — the Web search row is removed, since
the composer now owns that switch. The panel becomes Photos and Files.

**`src/components/ModelSheet.tsx`** (new, replacing `ModelPicker.tsx`) — the
`SourcesSheet` treatment, which is what the model list should have been all
along: a `Modal` with 72% max height, drag-to-dismiss off its header,
`colors.groupedCard`, `layout.screenPadding`, and hairline-divided rows. Each
row is mark + label + a check on the active one.

- A search field and provider filter chips appear only once the catalog passes 8
  entries; below that the list stands alone. With one combo a search field is
  furniture.
- Provider, for the filter chips, is the same first token the icon slug uses —
  so a chip and an icon can never disagree about what a model is. Grouping by
  `owned_by` would yield exactly one group called "combo".
- An empty catalog reads "No models configured — add a combo in 9router."

**`src/components/NavBar.tsx`** — the leading slot goes empty. `modelBadge`,
`onPressTitle`, the "ChatGPT" wordmark and the chevron all come out. With
derived labels the pair would read "ChatGPT Qwen 3.7 Max ›", and a chevron that
opens nothing is a lie.

**`app/(app)/index.tsx`** — `MODEL_LABEL` and `modelPickerOpen` are deleted;
the sheet's open state moves to the composer's control row.

## Error handling

| Failure | Behaviour |
|---|---|
| `/models` fails upstream, cache warm | Serve the stale list. A blip must not empty the picker. |
| `/models` fails upstream, cache cold | `502`; the client shows the empty state. |
| `AI_MODEL_DEFAULT` not in the catalog | Log loudly, use the first combo. |
| Catalog is empty | Sheet reads "No models configured — add a combo in 9router." |
| Client sends an unknown model | JSON `400 unknown_model`, before `openStream`. |
| Persisted model no longer in the catalog | Replaced with `defaultModel` on catalog arrival. |
| Icon slug has no lobehub file | `-color` → mono → lettered circle. |
| Offline, icon never fetched | Lettered circle. Once seen, AsyncStorage serves it. |

Upstream error bodies stay logged and unforwarded, as `ai.ts` already documents:
an upstream error can quote the request, and echoing it is how key fragments and
internal hostnames leak.

## Testing

- `models.ts`: filters to combos; derives labels; serves stale on a failed
  refresh; falls back when `AI_MODEL_DEFAULT` is absent; `resolveModel` throws
  400 on an unknown id.
- Route ordering: an unknown model yields a JSON 400 with no SSE frames — the
  regression that matters, since getting it wrong is invisible until a client
  sees a half-open stream.
- `modelIcon.ts`: alias table and raw fallthrough; `-color` → mono → circle.
- `ChatStore`: a stale persisted model is replaced on catalog arrival; a valid
  one is kept.
- Composer: collapsed layout unchanged; focus expands; blur with a draft does
  not collapse; the globe toggles both ways.

## Out of scope

Per-combo strategy display, capability-gated attachments, context-window
display, and combo management from inside the app. The proxy owns all four.
