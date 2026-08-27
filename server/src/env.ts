import 'dotenv/config';
import { z } from 'zod';

import type { Memory as SandboxMemory } from '@deno/sandbox';

/**
 * An optional string that treats blank as absent.
 *
 * `.optional()` alone is not enough: a key present in .env with an empty value --
 * which is exactly how .env.example ships every field a developer has not filled in
 * yet -- arrives as `""` and fails `.min(1)`. So copying the example file would stop
 * the server from booting over a feature nobody had enabled, which is the opposite
 * of what "optional" is for here.
 */
const optionalText = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().min(1).optional(),
);

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  /**
   * Pooled Neon endpoint (PgBouncer) — used by the running server.
   * The Prisma CLI deliberately uses DIRECT_URL instead; see prisma.config.ts.
   */
  DATABASE_URL: z.string().min(1),

  CLERK_PUBLISHABLE_KEY: z.string().min(1),
  /** Server-only. Never ships to the client. */
  CLERK_SECRET_KEY: z.string().min(1),

  /** Comma-separated origin list, or '*' for local development. */
  CORS_ORIGIN: z.string().default('*'),

  /**
   * Comma-separated list of origins allowed to have minted the session token we
   * accept. Leaving it empty accepts tokens from any of this Clerk app's
   * frontends, which is the normal setup for a native client.
   */
  CLERK_AUTHORIZED_PARTIES: z.string().optional(),

  /**
   * Any OpenAI-compatible endpoint; the URL includes the `/v1` prefix. Stored
   * without a trailing slash so paths can be joined with a plain template.
   */
  AI_BASE_URL: z
    .string()
    .url()
    .transform((value) => value.replace(/\/+$/, '')),
  /** Server-only, like CLERK_SECRET_KEY. The app never sees this. */
  AI_API_KEY: z.string().min(1),

  /*
   * The app's model picker offers three tiers, not vendor model ids -- those
   * differ per endpoint and would otherwise be baked into the client bundle,
   * where changing one means shipping a new build.
   */
  AI_MODEL_FAST: z.string().min(1),
  AI_MODEL_BALANCED: z.string().min(1),
  AI_MODEL_SMART: z.string().min(1),

  /*
   * --- Web search -----------------------------------------------------------
   *
   * The same deployment and the same key as the chat models above: this endpoint
   * exposes /search and /web/fetch alongside /chat/completions, so there is no
   * second credential to configure and nothing to enable per environment.
   *
   * What is configurable is the provider each call names, because that is the one
   * part the deployment does not default for us -- it rejects an unknown provider
   * rather than picking one.
   */

  /** Search provider. `exa` is the only one with search credentials on this deployment. */
  AI_SEARCH_PROVIDER: z.string().min(1).default('exa'),
  /** Page-fetch provider. `exa` is fastest; `firecrawl` returns cleaner titles for double the cost. */
  AI_FETCH_PROVIDER: z.string().min(1).default('exa'),
  /**
   * Turns the tool off without removing the credentials, the way SANDBOX_PERSIST
   * turns off volumes. Any value but "false" leaves it on.
   */
  WEB_SEARCH: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),

  /*
   * --- Code execution (Deno Sandbox) ---------------------------------------
   *
   * All optional. Without a token the /execute route reports itself unavailable
   * and nothing else changes -- a developer who has not set up Deno Deploy still
   * gets a server that boots, which is why these are not `.min(1)` requirements
   * like the keys above.
   */

  /** Organization token (`ddo_`) or personal token (`ddp_`, which needs the org too). */
  DENO_DEPLOY_TOKEN: optionalText,
  /** Required only for a personal token; an org token already names its org. */
  DENO_DEPLOY_ORG: optionalText,

  /** Sandboxes, volumes and snapshots must all share one region. */
  SANDBOX_REGION: z.enum(['ord', 'ams']).default('ord'),

  /**
   * Snapshot slug holding the pre-installed toolchains, built once by
   * `npm run sandbox:provision`. Without it a run boots the stock image, which
   * has Deno but no g++, python3 or JDK -- so those languages would fail on a
   * missing binary rather than on the user's code.
   */
  SANDBOX_SNAPSHOT: optionalText,

  /** Wall clock for one run, compile included. */
  SANDBOX_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(20_000),
  /**
   * RAM per sandbox. The platform accepts 768MiB-4096MiB.
   *
   * Shaped rather than free text, because the SDK's `Memory` type is a template
   * literal union and a bare string would need a cast at the call site -- a cast that
   * would happily pass "lots" through to fail at run time. The pattern is the same
   * one the SDK accepts, so what typechecks here is what the platform will take.
   */
  SANDBOX_MEMORY: z
    .string()
    .regex(/^\d+(GB|MB|kB|GiB|MiB|KiB)$/, 'Expected a size like "1280MiB" or "2GB".')
    .default('1280MiB')
    .transform((value) => value as SandboxMemory),

  /**
   * How many sandboxes this server will hold open at once. Deno Deploy allows 5
   * per organization during the pre-release, and going over that fails the
   * create call rather than queueing, so the default leaves headroom.
   */
  SANDBOX_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(3),

  /**
   * Give each user a persistent volume mounted at /workspace, so files a run
   * writes are still there on the next one. Set to "false" to run entirely in
   * the sandbox's ephemeral disk.
   */
  SANDBOX_PERSIST: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  /**
   * Size of that per-user volume.
   *
   * 400MB, not the 300MB the docs give as the floor: a create at 300MB comes back
   * INTERNAL_SERVER_ERROR every time, while 400MB and up succeed. Verified against
   * ord by walking the range.
   */
  SANDBOX_VOLUME_CAPACITY: z
    .string()
    .regex(/^\d+(GB|MB|kB|GiB|MiB|KiB)$/, 'Expected a size like "400MB" or "1GiB".')
    .default('400MB')
    .transform((value) => value as SandboxMemory),
  /*
   * --- Attachment uploads (Transloadit) -------------------------------------
   *
   * Optional, exactly like the sandbox block above: without a key pair the
   * /uploads route reports itself unavailable and everything else still boots.
   * A developer who has not signed up for Transloadit gets a working chat that
   * cannot take attachments, rather than a server that refuses to start.
   */

  /** Public Auth Key. Signed requests carry it in the clear; it is not the secret. */
  TRANSLOADIT_KEY: optionalText,
  /**
   * Auth Secret, used only to sign request params. Server-only, like
   * CLERK_SECRET_KEY and AI_API_KEY: it never reaches the app, a log line or a
   * client-visible error.
   */
  TRANSLOADIT_SECRET: optionalText,
  /**
   * The saved Template an upload runs through. Held in env rather than the
   * source so the pipeline can be edited in Transloadit's console and re-pointed
   * here without a deploy.
   */
  TRANSLOADIT_TEMPLATE_ID: z.string().min(1).default('d614e494f87245628e6ae1e8e989aa33'),
  /**
   * Ceiling on one attachment, in bytes. Enforced by the route before a byte
   * reaches Transloadit, so a large file is refused here rather than spending
   * upload minutes to be refused there.
   */
  UPLOAD_MAX_BYTES: z.coerce.number().int().min(1).max(50_000_000).default(20_000_000),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  // Report key NAMES only, never values — this output can land in logs.
  const keys = [...new Set(parsed.error.issues.map((issue) => issue.path.map(String).join('.')))];
  console.error(`[env] Invalid or missing environment variables: ${keys.join(', ')}`);
  console.error('[env] Set them in server/.env (see server/.env.example). Never commit real keys.');
  process.exit(1);
}

export const env = parsed.data;

const splitList = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

export const corsOrigins: string | string[] =
  env.CORS_ORIGIN.trim() === '*' ? '*' : splitList(env.CORS_ORIGIN);

export const authorizedParties = splitList(env.CLERK_AUTHORIZED_PARTIES);

/** The app's `ModelId` union (src/store/types.ts) resolved to real model ids. */
export const aiModels = {
  'gpt-3.5': env.AI_MODEL_FAST,
  'gpt-4': env.AI_MODEL_BALANCED,
  'gpt-5': env.AI_MODEL_SMART,
} as const;

export type AppModelId = keyof typeof aiModels;

/**
 * Whether code execution is configured at all.
 *
 * Checked by the route rather than asserted at boot: the app ships the Run
 * affordance regardless, and a clear 503 from one endpoint is a better failure
 * than a server that refuses to start for want of a feature nobody enabled.
 */
export const sandboxEnabled = Boolean(env.DENO_DEPLOY_TOKEN);

/**
 * Whether the model may search the web when the user asks it to.
 *
 * Unlike `sandboxEnabled` this needs no extra credential -- the search endpoint
 * lives on AI_BASE_URL behind AI_API_KEY, both of which are already required -- so
 * the only thing it can be off for is a deliberate WEB_SEARCH="false". The client
 * still ships the toggle either way, and a request with it on simply comes back
 * without having searched.
 */
export const webSearchEnabled = env.WEB_SEARCH;

/**
 * Whether attachment uploads are configured at all.
 *
 * Both halves of the pair or neither: a key with no secret cannot sign a request,
 * and reporting the feature available would turn a missing credential into an
 * upload that fails at the last moment.
 */
export const uploadsEnabled = Boolean(env.TRANSLOADIT_KEY && env.TRANSLOADIT_SECRET);

export const appModelIds = Object.keys(aiModels) as [AppModelId, ...AppModelId[]];
