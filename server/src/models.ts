import { env } from './env.ts';
import { HttpError } from './http.ts';

/**
 * The list of models the app may pick from, read from the proxy rather than
 * configured here.
 *
 * The point of this file is that enabling a model upstream is the whole of the
 * work: no env var, no union to widen, no deploy. So nothing below is allowed to
 * know the name of any particular model -- the label is derived from the id, and
 * the only thing this server asserts about the catalog is which entries belong in
 * it.
 *
 * Only "combos" do. A combo groups several provider models under one name and
 * handles retry and fallback inside the proxy, which is why the app can treat one
 * as a single model and never implement a retry of its own. The proxy marks them
 * two ways -- `owned_by: "combo"` and a `-combo` id suffix -- and both are checked,
 * so neither changing on its own empties the picker.
 */

/** One entry of the proxy's `/models` response, as far as this server cares. */
type UpstreamModel = {
  id?: unknown;
  owned_by?: unknown;
};

export type CatalogModel = {
  id: string;
  /** Derived from the id; see `deriveLabel`. */
  label: string;
};

/** How long a fetched catalog is served before the next request refreshes it. */
const TTL_MS = 5 * 60 * 1000;

/**
 * Floor between two forced refreshes, whatever the client asks for.
 *
 * A forced refresh is a user action -- opening the picker -- so it is as fast as the
 * user's thumb. This is what stops that from becoming a tap-per-request on the
 * proxy: reopening the sheet twice in a row is one upstream call, and the second tap
 * gets the list the first one fetched, which is the same list.
 */
const MIN_REFRESH_MS = 10_000;

/** Deadline for one upstream listing. Short: a stale list beats a slow picker. */
const TIMEOUT_MS = 10_000;

type Cache = {
  models: CatalogModel[];
  /** When it was fetched, so `TTL_MS` can be applied. */
  at: number;
};

let cache: Cache | null = null;
/** In-flight refresh, so N simultaneous requests make one upstream call. */
let inFlight: Promise<CatalogModel[]> | null = null;

const isCombo = (id: string, ownedBy: unknown): boolean =>
  ownedBy === 'combo' || id.endsWith('-combo');

/**
 * "qwen-3.7-max-combo" -> "Qwen 3.7 Max".
 *
 * Rules rather than a lookup table, because a table would have to be edited for
 * every model added upstream -- which is the exact cost this feature exists to
 * remove. So: drop a `provider/` prefix, drop the `-combo` suffix, split on the
 * separators, and capitalise words while leaving anything containing a digit
 * alone. That last part is what keeps "3.7" and "4o" from becoming "3.7" with a
 * capital nothing, and it is why the rule is "capitalise letters-only tokens"
 * rather than "title-case everything".
 *
 * A combo named unhelpfully upstream gets an unhelpful label here. That is the
 * right failure: the name is the one thing the person who created it chose.
 *
 * Mirrored in the app as `deriveModelLabel` in `src/lib/modelLabel.ts`, so the
 * composer can name a stored model before this list has arrived. Change one and you
 * must change the other: the app compares the two strings by showing one and then
 * the other, so a divergence appears as the chip's label changing a second after
 * launch.
 */
export function deriveLabel(id: string): string {
  const withoutOwner = id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id;
  const stem = withoutOwner.replace(/-combo$/, '');
  const words = stem
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => (/\d/.test(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)));
  // An id that was nothing but "-combo" would leave no words; show it verbatim
  // rather than an empty row.
  return words.length > 0 ? words.join(' ') : withoutOwner;
}

/** GETs the proxy's listing and reduces it to the combos, or throws. */
async function fetchCatalog(): Promise<CatalogModel[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${env.AI_BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${env.AI_API_KEY}` },
      signal: controller.signal,
    });

    if (!response.ok) {
      /*
       * Clipped and logged, never forwarded: an upstream error can quote the
       * request it failed on, and echoing that is how a key fragment or an
       * internal hostname reaches a client. Same rule as ai.ts and search.ts.
       */
      const detail = await response.text().catch(() => '');
      console.error(`[models] /models -> ${response.status}`, detail.slice(0, 300));
      throw new HttpError(502, 'Could not read the model list.', 'models_unavailable');
    }

    const payload = (await response.json()) as { data?: unknown };
    const rows = Array.isArray(payload.data) ? payload.data : [];

    /*
     * Read field by field rather than cast. The proxy is free to add fields, drop
     * the ones this server ignores, or return a row with no id at all, and none of
     * those should be able to crash a request -- a malformed row is skipped.
     */
    return rows.flatMap((row) => {
      if (!row || typeof row !== 'object') return [];
      const { id, owned_by: ownedBy } = row as UpstreamModel;
      if (typeof id !== 'string' || id.length === 0) return [];
      if (!isCombo(id, ownedBy)) return [];
      return [{ id, label: deriveLabel(id) }];
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The catalog, from cache when it is fresh.
 *
 * A failed refresh keeps serving the previous list. An upstream blip should not
 * empty every user's picker mid-session, and a five-minute-old list of enabled
 * models is very nearly always still correct. Only a cold cache surfaces the
 * failure, because then there is genuinely nothing to show.
 *
 * `force` skips the TTL. Sends never ask for it -- a five-minute-old list is fine
 * for validating an id -- but opening the picker does: that is the moment a user who
 * just enabled a combo upstream is looking for it, and telling them to wait out a
 * timer they cannot see (or to restart the app) is the failure this whole feature
 * exists to avoid. Still floored by `MIN_REFRESH_MS`, and still one upstream call
 * however many clients ask at once.
 */
export async function getModels({ force = false } = {}): Promise<CatalogModel[]> {
  const age = cache ? Date.now() - cache.at : Infinity;
  if (cache && age < (force ? MIN_REFRESH_MS : TTL_MS)) return cache.models;

  inFlight ??= fetchCatalog()
    .then((models) => {
      cache = { models, at: Date.now() };
      return models;
    })
    .catch((error) => {
      if (cache) {
        console.warn('[models] refresh failed; serving the cached list', error);
        return cache.models;
      }
      throw error;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/**
 * The model a client gets when it names none, or names one that no longer exists.
 *
 * `AI_MODEL_DEFAULT` when the catalog actually contains it. Otherwise the first
 * combo, loudly: a typo in the env var should cost a warning in the log, not every
 * send in the app.
 */
export function defaultModel(models: CatalogModel[]): string | null {
  if (models.length === 0) return null;

  const configured = env.AI_MODEL_DEFAULT;
  if (configured) {
    if (models.some((model) => model.id === configured)) return configured;
    console.warn(
      `[models] AI_MODEL_DEFAULT is not in the catalog; falling back to ${models[0].id}`,
    );
  }
  return models[0].id;
}

/**
 * Checks a model id against the live catalog.
 *
 * Callers must run this *before* opening the SSE stream. Once headers are out an
 * error can only be reported in-band as an `{type:'error'}` frame, so validating
 * late turns a plainly wrong request into what looks to the client like a reply
 * that failed halfway.
 */
export async function resolveModel(id: string | undefined): Promise<string> {
  const models = await getModels();

  if (!id) {
    const fallback = defaultModel(models);
    if (!fallback) {
      throw new HttpError(503, 'No models are configured.', 'no_models');
    }
    return fallback;
  }

  if (!models.some((model) => model.id === id)) {
    throw new HttpError(400, 'Unknown model.', 'unknown_model');
  }
  return id;
}
