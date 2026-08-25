# mirai-server

Express 5 + Prisma 7 API for the Mirai Expo app. Authentication is Clerk; the
database is the pre-existing Neon Postgres instance.

## Why the schema looks the way it does

`prisma/schema.prisma` was **introspected from the existing database**, not authored
first. The database already had `users`, `agent_profiles`, `conversations`,
`messages` and a hand-rolled `migrations` ledger, and it was Clerk-native from the
start (`users.clerk_user_id`).

After `prisma db pull`, the models were renamed by hand to idiomatic Prisma
(`PascalCase` models, `camelCase` fields, `@@map`/`@map` back to the real
snake_case names). Those renames **survive re-introspection** — verified
empirically: re-running `db pull` only reorders blocks and re-reports the enum
`@@map`s, it does not revert names.

Two consequences worth knowing:

- `db pull` **strips `//` comments** from the schema. Only `///` doc comments
  survive. That is why this provenance note lives in a README instead.
- Prisma Migrate is **not** driving this database. The `migrations` model maps the
  pre-existing ledger table and is left alone. Do not run `prisma migrate`.

`archived` has no column, so the API always reports `archived: false`. Persisting
it would need a schema change, which was deliberately left out of this pass.

`updated_at` columns are plain `@default(now())`, **not** Prisma's `@updatedAt`, so
every write sets `updatedAt` explicitly. Removing those looks like a cleanup and is
actually a bug.

## Prisma 7 gotchas

- `url` is **no longer allowed** in the `datasource` block (`P1012` if you add it).
  The connection string lives in `prisma.config.ts`, which reads `DIRECT_URL`.
- A **driver adapter is required**: `@prisma/adapter-pg` over `pg`, wired in
  `src/db.ts` against the pooled `DATABASE_URL`.
- The generated client is emitted to `src/generated/prisma` (gitignored), not into
  `node_modules`, and imports siblings with explicit `.ts` extensions — hence
  `allowImportingTsExtensions` in `tsconfig.json`.

## Setup

```bash
npm install
cp .env.example .env      # then fill in the four real values
npm run prisma:generate
npm run dev
```

Code execution — the Run button under a chat reply's code fence — is a separate,
optional subsystem with its own setup, and it has its own guide:
**[SANDBOX.md](SANDBOX.md)**. With no `DENO_DEPLOY_TOKEN` the server starts
normally and reports the runner unavailable, so you can skip it entirely.

## Auth model

Stateless bearer tokens, which is the right shape for a native client:

1. The app signs in with Clerk (email one-time code, passwordless) and calls
   `getToken()` for a short-lived session JWT.
2. It sends `Authorization: Bearer <jwt>`.
3. `clerkMiddleware()` verifies that JWT against Clerk's cached JWKS —
   **networkless**, no per-request round-trip, no hand-rolled `jsonwebtoken`.
4. `requireAuth` (ours, in `src/auth.ts`) turns a missing session into a JSON 401.
   Clerk's own `requireAuth()` is deprecated *and* redirects to a sign-in page,
   which is useless for a JSON API.
5. `withUser` resolves the Clerk subject to a local row, creating it on first sight
   (just-in-time provisioning, so sign-up needs no webhook). A webhook is still the
   right way to propagate account **deletion** later.

Ownership is enforced by scoping every query with `userId`, so another account's
row is indistinguishable from a nonexistent one — 404, never 403, no existence leak.

## Routes

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/healthz` | Liveness. Does not touch the database. |
| GET | `/readyz` | Readiness. `SELECT 1` against Neon. |
| GET | `/api/v1/me` | Local id + Clerk id + primary email (read from Clerk). |
| GET | `/api/v1/profile` | Agent profile; heals a missing row. |
| PATCH | `/api/v1/profile` | `displayName`, `tone`, `verbosity`, `customInstructions`. |
| GET | `/api/v1/conversations` | Summaries only — no message bodies. |
| POST | `/api/v1/conversations` | `{ title? }` |
| GET | `/api/v1/conversations/:id` | Full conversation with messages. |
| PATCH | `/api/v1/conversations/:id` | `{ title }` (nullable). |
| DELETE | `/api/v1/conversations/:id` | Cascades to messages. |
| GET | `/api/v1/conversations/:id/messages` | `?limit=&after=` cursor pagination. |
| POST | `/api/v1/conversations/:id/messages` | `{ role, text, model?, pending? }` |
| PATCH | `/api/v1/conversations/:id/messages/:messageId` | `{ text?, pending? }` — finalize a stream. |

Everything under `/api/v1` is authenticated. The DTO layer (`src/dto.ts`) translates
`content`→`text`, `status`→`pending`, `Date`→epoch ms, and hides `system` messages.

There is no model wired up yet: the message endpoints are a persistence layer for
text the client produces. Server-side generation slots in behind `POST .../messages`.

## The `deepmerge-ts` override

`package.json` pins `deepmerge-ts` to `^8.0.2` via `overrides`. Prisma 7.9.1 ships
`@prisma/config` → `deepmerge-ts@7.1.5`, which carries a high-severity stack
exhaustion advisory (GHSA-ggr8-5vv4-36mx), and `@prisma/client` pulls the CLI into
the production tree — so it is not dev-only. `npm audit fix --force` "fixes" it by
downgrading to `prisma@6.12.0`, which would undo the Prisma 7 setup entirely. The
override is the non-breaking path: `prisma validate`, `prisma generate` and
`tsc --noEmit` all pass against v8, and `npm audit` reports zero vulnerabilities.
Drop the override once Prisma ships a `@prisma/config` that depends on v8 itself.
