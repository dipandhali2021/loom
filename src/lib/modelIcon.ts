import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Provider marks for model ids, from the lobehub icon set.
 *
 * Fetched from lobehub's static CDN rather than bundled. `@lobehub/icons-rn` is one
 * 3.6MB barrel with no subpath exports, and Metro does not tree-shake it reliably,
 * so importing its `ModelIcon` would put most of 200-odd brand SVGs into the app
 * bundle to render one of them -- plus an `expo-linear-gradient` peer dependency.
 * A URL per provider costs nothing and is cached after first sight.
 *
 * Rendered through `react-native-svg`, not `expo-image`. The SDK 57 image docs warn
 * that iOS's system SVG decoder mishandles an elliptical arc whose large-arc and
 * sweep flags are packed against the following coordinate -- the form every SVG
 * minifier emits -- and point at `react-native-svg` for those paths. Lobehub's
 * files are minified exactly that way: `qwen-color.svg` has one such arc,
 * `openai.svg` four, `gemini-color.svg` eight. So they would render distorted or
 * not at all through the image component.
 */

/**
 * Slugs whose model family is not named after the brand that owns the icon.
 *
 * Deliberately short. The rule is "the id starts with its own provider's name",
 * which holds for `qwen-…`, `claude-…`, `gemini-…`, `mistral-…` and most of the
 * rest -- so a provider enabled upstream tomorrow needs no entry here, and this
 * table stays a patch for the exceptions rather than the mechanism.
 */
const ALIASES: Record<string, string> = {
  gpt: 'openai',
  o1: 'openai',
  o3: 'openai',
  o4: 'openai',
  chatgpt: 'openai',
  sonnet: 'claude',
  opus: 'claude',
  haiku: 'claude',
  fable: 'claude',
  glm: 'zhipu',
  qwq: 'qwen',
  llama: 'meta',
  command: 'cohere',
  kimi: 'moonshot',
  xiaomi: "xiaomimimo",
};

/**
 * "qwen-3.7-max-combo" -> "qwen"; "gpt-5-combo" -> "openai".
 *
 * The first token of the id, since that is where a provider puts its name, then
 * through the alias table. A `provider/` prefix is dropped first -- combos have
 * none, but a raw model id from the same catalog does.
 */
export function iconSlug(modelId: string): string {
  const withoutOwner = modelId.includes('/')
    ? modelId.slice(modelId.lastIndexOf('/') + 1)
    : modelId;
  const first = withoutOwner.toLowerCase().split(/[-_.]/).filter(Boolean)[0] ?? '';
  return ALIASES[first] ?? first;
}

/**
 * Candidate URLs for one slug, best first.
 *
 * `-color` does not exist for every provider: `qwen-color`, `claude-color`,
 * `gemini-color`, `deepseek-color` and `mistral-color` are all served, while
 * `openai-color` and `grok-color` 404 -- those ship a mono mark only. So the colour
 * variant is tried and the mono one is the fallback, which is why this returns a
 * list rather than a string.
 */
function candidates(slug: string): string[] {
  const base = 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons';
  return [`${base}/${slug}-color.svg`, `${base}/${slug}.svg`];
}

/** Cache key. Versioned, so a change to what is stored retires old entries. */
const cacheKey = (slug: string) => `model-icon-v1/${slug}`;

/**
 * A slug known to have no icon, so a miss is not re-fetched on every mount. Stored
 * as this sentinel rather than as an absent key, which would be indistinguishable
 * from "never looked".
 */
const MISS = '';

/** In-memory mirror of the store, so a re-render never waits on AsyncStorage. */
const memory = new Map<string, string>();
/** In-flight fetches, so ten rows of the same provider make one request. */
const pending = new Map<string, Promise<string>>();

async function load(slug: string): Promise<string> {
  const cached = await AsyncStorage.getItem(cacheKey(slug)).catch(() => null);
  if (cached !== null) return cached;

  for (const url of candidates(slug)) {
    try {
      const response = await fetch(url);
      if (!response.ok) continue;
      const xml = await response.text();
      // A CDN that answers 200 with an HTML error page is a miss, not a mark.
      if (!xml.trimStart().startsWith('<svg')) continue;
      await AsyncStorage.setItem(cacheKey(slug), xml).catch(() => { });
      return xml;
    } catch {
      // Offline, or DNS: fall through to the next candidate and then to the miss.
    }
  }

  /*
   * Only a definite 404 is remembered as a miss. A failed fetch is not: caching
   * "no icon" because the device happened to be offline would keep the mark
   * missing for good once the network came back.
   */
  return MISS;
}

/**
 * The SVG source for a model's provider, or an empty string when there is none.
 *
 * Never throws: every caller renders a lettered fallback when it gets nothing, and
 * a mark is not worth failing a screen over.
 */
export async function loadIcon(modelId: string): Promise<string> {
  const slug = iconSlug(modelId);
  if (!slug) return MISS;

  const held = memory.get(slug);
  if (held !== undefined) return held;

  let inFlight = pending.get(slug);
  if (!inFlight) {
    inFlight = load(slug)
      .then((xml) => {
        // Only a hit is memoised; a miss stays retryable within the session.
        if (xml) memory.set(slug, xml);
        return xml;
      })
      .finally(() => pending.delete(slug));
    pending.set(slug, inFlight);
  }
  return inFlight;
}

/**
 * First letter of the label, for the fallback mark.
 *
 * From the label rather than the id, so a combo named for its purpose shows the
 * letter a user would expect to see.
 */
export function initialOf(label: string): string {
  const letter = label.replace(/[^a-z0-9]/gi, '').charAt(0);
  return (letter || '?').toUpperCase();
}

/**
 * A hue per slug, so the same provider always falls back to the same colour.
 *
 * Same hash and the same fixed lightness as `Favicon`, so an un-fetched provider
 * mark and an un-fetched site mark look like siblings rather than two different
 * ideas about what a placeholder is.
 */
export function hueOf(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 3_600;
  }
  return hash % 360;
}
