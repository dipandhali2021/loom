import 'dotenv/config';
import { z } from 'zod';

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

export const appModelIds = Object.keys(aiModels) as [AppModelId, ...AppModelId[]];
