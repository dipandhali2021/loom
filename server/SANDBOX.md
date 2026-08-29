# Code execution — setup from scratch

How the Run button under a code block actually runs the code, and how to
rebuild the whole thing on a fresh machine and a fresh Deno Deploy account.

Every command here was run against a real account while writing this, and the
error messages in [§9](#9-troubleshooting) are the ones that actually came back
— not guesses about what might go wrong.

**Time:** about 20 minutes, most of it waiting for one `apt-get`.
**Cost:** nothing measurable. See [§8](#8-limits-and-cost).

**Contents** — [1 Architecture](#1-architecture) · [2 Requirements](#2-requirements) ·
[3 Token](#3-get-a-deno-deploy-token) · [4 Configure](#4-configure-the-server) ·
[5 Build the snapshot](#5-build-the-toolchain-snapshot) · [6 Run it](#6-run-it-end-to-end) ·
[7 How it fits](#7-how-the-pieces-fit) · [8 Limits](#8-limits-and-cost) ·
[9 Troubleshooting](#9-troubleshooting) · [10 Extending](#10-notes-for-anyone-extending-this)

If you only want it working, skip to [§2](#2-requirements) — sections 2 to 6 are
the setup, in order. [§1](#1-architecture) is what you are setting up and why it
is shaped that way.

---

## 1. Architecture

### 1.1 The whole path

One press of Run, from the pill to the microVM and back:

```
┌─ device ──────────────┐   ┌─ your server ─────────────────────┐   ┌─ Deno Deploy (ord) ────────┐
│                       │   │                                   │   │                            │
│ CodeBlock.tsx         │   │ POST /api/v1/execute              │   │                            │
│   isRunnable(lang)?   │   │   │                               │   │                            │
│   RunPill ── press ──▶│──▶│   ├─ clerkMiddleware  verify JWT  │   │                            │
│                       │   │   ├─ requireAuth      401 if none │   │                            │
│ lib/api.ts            │   │   ├─ withUser         Clerk → row │   │                            │
│   runCode(getToken,…) │   │   ├─ zod              ≤100k chars │   │                            │
│   Bearer <jwt>        │   │   │                               │   │                            │
│                       │   │ sandbox/run.ts                    │   │                            │
│                       │   │   ├─ recipeFor(lang)  400 if none │   │                            │
│                       │   │   ├─ slots.take()     ≤3, queue 12│   │                            │
│                       │   │   ├─ claim volumeInUse            │   │                            │
│                       │   │   ├─ Volume.get/create   ─────────│──▶│ vol_ord_…   400MB  per user│
│                       │   │   ├─ Sandbox.create      ─────────│──▶│ sbx_ord_…   Firecracker VM │
│                       │   │   │    root = loom-toolchains     │   │   ├ / (ro)  gcc g++ py jdk │
│                       │   │   │    volumes {/workspace: vol}  │   │   ├ /workspace (rw)        │
│                       │   │   │    allowNet: []               │   │   └ egress blocked         │
│                       │   │   ├─ fs.writeTextFile main.py     │   │                            │
│                       │   │   ├─ fs.writeTextFile run.sh      │   │                            │
│                       │   │   ├─ spawn bash -lc               │   │  run.sh > out 2> err       │
│                       │   │   │    stdio all 'null'           │   │  (user code executes here) │
│                       │   │   ├─ await output()   ⏱ 20s abort │   │                            │
│                       │   │   ├─ trim + fs.readTextFile ×2    │   │  out, err  ≤80KB each      │
│                       │   │   └─ kill()  ── finally ──────────│──▶│ VM destroyed               │
│                       │   │      release volume + slot        │   │                            │
│ Output panel     ◀────│◀──│ { stdout, stderr, exitCode,       │   │                            │
│   exit code, ms       │   │   timedOut, truncated,            │   │                            │
│   truncation note     │   │   durationMs, persisted }         │   │                            │
└───────────────────────┘   └───────────────────────────────────┘   └────────────────────────────┘
```

Nothing is streamed. A reply streams because the first token is useful long
before the last; a run does not — you cannot act on half a program's output, and
20 seconds is a fair single wait. One request, one JSON body.

### 1.2 Two boundaries, and what each one actually stops

```
  chat reply  ──▶  ①  microVM: own kernel, own fs, own netns, destroyed after one run
                        │
                        ├── ②  deno run, no --allow-*, --no-prompt      ← ts / js ONLY
                        │        └ NotCapable on file read, fetch, spawn
                        │
                        └──     python3 / gcc / g++ / java              ← no inner boundary
                                 └ full user-level access to the VM
```

**① is the boundary that matters.** A Firecracker microVM — the same technology
as AWS Lambda — with a separate kernel, filesystem, network namespace and
process space, created for one run and destroyed at the end of it.

**② is a bonus that only covers Deno.** `deno run` with no `--allow-*` flags
cannot read the filesystem, reach the network or spawn anything. `--no-prompt`
matters as much as the absent flags: without it a denied operation stops and
waits for a keypress that never comes, burning the entire timeout.

**The other four languages have no inner boundary at all.** A Python script here
can open sockets, read `/etc`, fork, and fill the disk. That is the honest limit
of this design, and what stops it mattering is layered:

| Concern | What actually prevents it |
| --- | --- |
| Reading another user's code | Separate VM per run; volumes are per-user and single-mount |
| Reaching the internet | `allowNet: []` at the platform, below the VM — `403 Forbidden: this domain is not allowed` for HTTP, `ConnectionRefusedError` for raw TCP |
| Reaching your server or database | Same. The VM has no route to anything, including your Neon instance |
| Never terminating | Two deadlines: a 20s `AbortSignal` → SIGTERM, and the platform's own `SANDBOX_TIMEOUT_MS + 30s` VM lifetime |
| Filling the disk | 400MB volume quota; the read-only root cannot be written at all |
| Flooding your server with output | Trimmed in the VM before it crosses the wire, then clipped again in Node |
| Persisting an implant | Root fs is read-only; only `/workspace` survives, and only for that user |
| Exhausting the account | Counting semaphore at `SANDBOX_CONCURRENCY`, queue capped at 12 |

The last row is worth stating plainly: **the code runs on a machine that holds
nothing and can reach nothing.** No credentials are mounted, no environment
variables are passed in, and there is no network path back to your
infrastructure.

### 1.3 Sandbox vs volume vs snapshot

Three separate platform resources, easy to conflate because all three appear in
one `Sandbox.create` call. They differ in what they are, how long they live, and
who can hold them.

| | **Sandbox** | **Volume** | **Snapshot** |
| --- | --- | --- | --- |
| What it is | A running Firecracker microVM — CPU, RAM, kernel, processes | A block device. Storage only, nothing executes | A frozen, read-only copy of a volume |
| Id shape | `sbx_ord_…` | `vol_ord_…` (or its slug) | slug, e.g. `loom-toolchains` |
| Lifetime | Seconds. Killed after one run, or reaped at its `timeout` | Indefinite, until deleted | Indefinite, until deleted |
| Writable | Yes, but only where a rw volume is mounted | Yes | **No, ever** |
| How many at once | **Capped: 5 per org.** The scarce thing | Not in the quota list | Not in the quota list |
| Concurrent holders | n/a | **Exactly one sandbox at a time** | **Unlimited** — any number boot from it |
| Costs | CPU time + memory time while running | Allocated storage | Allocated storage |
| In this project | One per press of Run | One per user, mounted at `/workspace`, plus one 8GB build scratch | One: the toolchain image every run boots |

The distinction that drives the whole design is the **concurrent holders** row.
A sandbox needs a root filesystem, and it can come from either a volume or a
snapshot:

```
root = a volume     →  single-mount  →  press #2 waits for press #1   ✗
root = a snapshot   →  unlimited     →  every press boots immediately  ✓
```

So the toolchains live in a *snapshot*, and the only *volume* in a run is the
user's own 400MB `/workspace` — where single-mount is acceptable, because a
second press by the same user can fall back to running without it.

A volume is also the only way to *build* an image: you cannot write to a
snapshot, so provisioning installs into a writable volume and freezes the result.
That is the entire job of `loom-toolchain-build`.

Two consequences that cause confusing errors later, both in [§9](#9-troubleshooting):
a volume cannot be deleted while a sandbox holds it, and a volume cannot be
deleted while a snapshot was cut from it.

### 1.4 How the three fit together

```
  builtin:debian-13                       the platform's stock Debian image
        │
        │  provision, ONCE  (§5)
        ▼
  loom-toolchain-build      8GB    rw     scratch. apt runs here. kept only because
        │                                 a volume with snapshots cannot be deleted
        │  volumes.snapshot()
        ▼
  loom-toolchains         0.85GB   RO     ◀── every run boots this as /
        │                                     gcc 14.2 · g++ 14.2 · python 3.13.5
        │                                     openjdk 21.0.10 · deno 2.9.5
        │  root: on every Sandbox.create
        ▼
  ┌───────────────────────────────────────────────────────┐
  │ sbx_ord_…   one per press, ~1s boot, then destroyed   │
  │                                                       │
  │   /                 from the snapshot, READ-ONLY      │
  │   /workspace        loom-ws-<userhex>   400MB  rw     │──▶ survives the run
  │   /tmp/loom         run dir when no volume  (ephemeral)│
  │   /tmp/loom-io      run.sh, out, err        (ephemeral)│
  └───────────────────────────────────────────────────────┘
```

Why `/workspace` is a **separate per-user volume**: it is the one thing meant to
survive a run, so a second press can `import` the module the first one wrote. It
is single-mount, which is what `volumeInUse` exists for — see 1.6.

Why the output files live in **`/tmp`, not `/workspace`**: output is a by-product
of one press. Putting it on the volume would spend the user's 400MB on it and
leave the previous run's output there for the next run to trip over.

The slug is derived from the user's row id, not stored:
`loom-ws-` + 24 hex characters of the UUID = exactly 32, the platform's ceiling.
No migration, no extra column, and the volume is identifiable in the dashboard.

### 1.5 Request lifecycle, and what each failure looks like

```
POST /api/v1/execute
  │
  ├─ sandboxEnabled false? ─────────────▶ 503 sandbox_unavailable
  ├─ no/invalid JWT ────────────────────▶ 401   (clerkMiddleware + requireAuth)
  ├─ body not {code, lang} or >100k ────▶ 400   (zod, before any platform call)
  ├─ res.on('close') → AbortController         ← client hung up; tears the run down
  │
  ├─ runCode()
  │    ├─ recipeFor(lang) null ─────────▶ 400 cannot_run + supported list
  │    ├─ slots.take()
  │    │     free? take it
  │    │     full & queue <12? wait
  │    │     queue ≥12 ─────────────────▶ 400 "The code runner is busy."
  │    ├─ boot, 30s deadline of its own  ← a slow platform must not eat the user's 20s
  │    │     late arrival? kill it       ← or it holds a slot for its whole lifetime
  │    ├─ run, 20s deadline ────────────▶ exitCode 124, timedOut true, partial output kept
  │    ├─ read out/err (even when killed)
  │    └─ finally: kill VM, drop volume claim, release slot   ← in that order
  │
  └─ anything else ─────────────────────▶ 502 sandbox_failed, full detail logged only
```

Three deliberate choices in there:

**A non-zero exit is not an error.** A program with a syntax error ran exactly as
asked, and its message belongs on screen. Only the *request* failing — no
session, no runner, platform unavailable — throws.

**Platform errors are not forwarded.** An expired token or a quota message can
carry account detail, so the client gets a fixed string and the real error is
logged server-side.

**The teardown order is fixed.** Kill the VM, *then* drop the volume claim, *then*
release the slot. The next run to take either needs this VM actually gone, not
merely disconnected — which matters because disconnecting is all `await using`
does (§10).

### 1.6 Concurrency: three separate limits

They are easy to confuse, and they guard different things.

| Guard | Where | Value | Protects against |
| --- | --- | --- | --- |
| `slots` semaphore | `run.ts`, per process | `SANDBOX_CONCURRENCY` = 3 | Deno's per-org cap. Over it, `create` fails 429 rather than queueing — so the queue lives here |
| `MAX_QUEUED` | `run.ts` | 12 | Unbounded waiting. Each queued press is a held-open HTTP connection and a spinner |
| `volumeInUse` | `run.ts`, per user | 1 per user | A volume is single-mount. A same-user second press would block on the mount |

```
  5  ── plan cap (free tier). create() → 429 past this
  3  ── SANDBOX_CONCURRENCY. leaves 2 free: one for provisioning, one for a stray
 12  ── queue depth. press 16 gets "busy, try again" instead of a dead spinner
```

`volumeInUse` degrades rather than waits. A second press by the same user runs
**ephemerally** — `persisted: false`, no `/workspace` — because waiting would
stall it behind a run that may have twenty seconds left, and a run without
`/workspace` still does what was asked. Observable:

```
concurrent a   exit=0  8245ms  persisted=true    ← got the volume
concurrent b   exit=0  6935ms  persisted=false   ← ran anyway, ephemeral
```

The claim is taken **before the first `await`**, not after. Testing the set and
then awaiting `workspaceVolume` would let two presses in the same tick both pass
the test and both mount — and it fails quietly, with both reporting `persisted`
while the second sits waiting on a mount it cannot have.

### 1.7 Why each run gets a fresh VM

A warm pool would be faster — most of the ~8s is boot — and it is the wrong
trade. A pooled VM carries the previous run's leftovers into the next one: a
background process still holding a port, a rewritten `/etc/hosts`, a filled
`/tmp`, a `sitecustomize.py` that hijacks every later Python run. Isolation
between two users' runs would then depend on cleanup code being correct, which is
a much weaker claim than "the machine no longer exists".

Boot is also cheaper than it looks: the snapshot means no `apt-get` on the hot
path, which is the difference between ~8 seconds and the minute a cold toolchain
install would take.

### 1.8 Trust boundaries at a glance

| Crossing | Direction | Treatment |
| --- | --- | --- |
| App → server | in | Clerk JWT verified against cached JWKS; `userId` is a resolved row id, never client-supplied |
| Server → sandbox | out | Code is sent as **data**, written to a file. Never interpolated into a command line |
| Sandbox → server | in | `stdout`/`stderr` are **untrusted strings**. Passed through, never parsed or evaluated |
| Server → app | out | Rendered as text. Platform error detail is stripped |
| Sandbox → internet | — | Blocked at the platform |

The recipe is written to `run.sh` rather than passed as `bash -lc <script>`
precisely because the command line already carries one level of quoting for the
output redirect, and nesting a second is how a recipe gets mangled by a quote it
did not expect. Verified: a program whose source contains
`"hi" > /dev/null; $(echo no)` and backticks comes back intact.

### 1.9 Files

| File | Lines | Role |
| --- | --- | --- |
| `server/scripts/provision-sandbox.ts` | ~400 | Builds the snapshot. Run once. Not on any request path |
| `server/src/env.ts` | — | Validates the `SANDBOX_*` block; exports `sandboxEnabled` |
| `server/src/sandbox/languages.ts` | ~120 | Fence label → compile/run recipe |
| `server/src/sandbox/run.ts` | ~490 | Slots, volumes, boot, run, capture, teardown |
| `server/src/routes/execute.ts` | ~100 | `POST /api/v1/execute`, `GET /api/v1/execute/status` |
| `src/lib/highlight.ts` | — | `RUNNABLE` — which fences get a button at all |
| `src/lib/api.ts` | — | `runCode`, `RunResult` |
| `src/components/CodeBlock.tsx` | — | The pill, its states, the output panel |

`languages.ts` and `RUNNABLE` in `highlight.ts` are two lists that must agree;
§7 covers what happens when they do not.

---

## 2. Requirements

| Thing | Version | Why |
| --- | --- | --- |
| Node.js | **22.13+** (verified on 24.17.0) | `await using` and top-level await |
| npm | 10+ | ships with Node |
| A Deno Deploy account | — | console.deno.com, free tier is enough |
| `deno` the CLI | **not needed** | see below |

**You do not need Deno installed.** `@deno/sandbox` is a plain npm package that
drives the Deploy API over HTTPS from Node. Nothing in this repo shells out to
`deno`. The only reason to install it is the optional `deno sandbox …` CLI for
poking at a sandbox by hand, and this guide never uses it.

Check Node first, because the failure otherwise is a syntax error deep in a
dependency:

```bash
node --version    # must be >= 22.13
```

Two things in `server/` are load-bearing and easy to "clean up" by mistake:

- `"type": "module"` in `server/package.json`. Without it `tsx` compiles to CJS
  and top-level `await` fails with *"Top-level await is currently not supported
  with the cjs output format"*.
- `@deno/sandbox` is pinned to an exact version (`"0.13.2"`, no `^`). Section 9
  documents three bugs in it that the code works around; a silent minor bump
  could change any of them.

---

## 3. Get a Deno Deploy token

1. Sign in at <https://console.deno.com>.
2. Create an organization if you have none — sandboxes are billed and
   rate-limited per organization, not per user.
3. Go to **Settings → Organization tokens** and create one. Copy it now; the
   console will not show it again.

**Which token type, and the one gotcha:**

| Prefix | Where | `DENO_DEPLOY_ORG` |
| --- | --- | --- |
| `ddo_` | Settings → **Organization** tokens | **not needed** — leave blank |
| `ddp_` | Settings → **Personal** access tokens | **required** |

This is worth getting right because the failure is confusing. The SDK does
this, in `client.js`:

```js
const token = options.token ?? process.env.DENO_DEPLOY_TOKEN;
if (!token.startsWith("ddo_") && !org) throw new MissingOrgError();
```

So a `ddo_` token carries its own organization and `DENO_DEPLOY_ORG` must stay
**empty**. A `ddp_` token does not, and without the org variable every call
fails with `MissingOrgError` — which reads like a missing token, not a missing
org. Use an organization token and skip the problem.

If you use `ddp_`, the org value is the slug in your console URL:
`console.deno.com/<this-part>`.

---

## 4. Configure the server

```bash
cd server
npm install
cp .env.example .env      # if you have not already
```

Then open `server/.env` and fill in the code-execution block. Everything else in
that file (Neon, Clerk, the AI endpoint) is covered by
[`server/README.md`](README.md).

```ini
# --- Code execution (Deno Sandbox) -------------------------------------------
DENO_DEPLOY_TOKEN="ddo_…"     # from §3
DENO_DEPLOY_ORG=""            # leave EMPTY for a ddo_ token

SANDBOX_REGION="ord"          # "ord" or "ams" -- see below
SANDBOX_SNAPSHOT=""           # §5 fills this in

SANDBOX_TIMEOUT_MS="20000"
SANDBOX_MEMORY="1280MiB"
SANDBOX_CONCURRENCY="3"
SANDBOX_PERSIST="true"
SANDBOX_VOLUME_CAPACITY="400MB"
```

Every one of these is optional. **With no token the server starts normally** —
`sandboxEnabled` is false, `GET /api/v1/execute/status` reports
`available: false`, the app greys the Run button out, and nothing else changes.
Nothing about code execution can take the server down at boot.

What the values mean, and which ones you should not guess at:

| Variable | Notes |
| --- | --- |
| `SANDBOX_REGION` | `ord` (Chicago) or `ams` (Amsterdam). **Sandboxes, volumes and snapshots must all be in one region** — a volume in `ams` cannot mount into a sandbox in `ord`. Pick once. |
| `SANDBOX_SNAPSHOT` | Left empty, runs boot the stock image, which has `deno` but no gcc/python/java — so `py` and `cpp` fences fail on a missing binary. §5 builds it. |
| `SANDBOX_TIMEOUT_MS` | Wall clock for one run, compile included. 1000–120000. 20s is comfortable for `g++ -std=c++20`. |
| `SANDBOX_MEMORY` | Per sandbox. `1280MiB` verified; `2GiB` also accepted. See [§8](#8-limits-and-cost) on the dashboard's "Runtime Memory" line, which is a different thing. |
| `SANDBOX_CONCURRENCY` | How many sandboxes this server holds at once. Keep it **below** your plan's cap (5 on the free tier) so `npm run sandbox:provision` can still boot one. |
| `SANDBOX_PERSIST` | `true` mounts a per-user volume at `/workspace`, so a file one run writes is there for the next. `false` runs entirely on the VM's ephemeral disk. |
| `SANDBOX_VOLUME_CAPACITY` | **Do not lower this to 300MB.** The docs give 300MB as the floor and a create at 300MB fails with `INTERNAL_SERVER_ERROR` every time — verified by walking 300/400/500/511/512/800/1000MB. 400MB is the smallest that works. |

The app side needs nothing new. `EXPO_PUBLIC_API_URL` already points at this
server, and the Run button goes through the same authenticated client as
everything else.

---

## 5. Build the toolchain snapshot

This is the one slow step, and you do it **once**.

```bash
cd server
npm run sandbox:provision
```

Expect **3–6 minutes**, nearly all of it one `apt-get`. Output looks like:

```
[provision] region ord
[provision] snapshot slug loom-toolchains
[provision] creating a bootable volume from builtin:debian-13
[provision] booting a sandbox on it (writable root)
[provision] installing build-essential, python3, default-jdk
[provision] (this is the slow part -- a few minutes is normal)

… hundreds of lines of apt output …

[provision] verifying the toolchains
           gcc (Debian 14.2.0-19) 14.2.0
           g++ (Debian 14.2.0-19) 14.2.0
           Python 3.13.5
           openjdk 21.0.10 2026-01-20
           deno 2.9.5
[provision] shutting the sandbox down to release the volume
[provision] freezing the volume into a snapshot

[provision] Done. Snapshot "loom-toolchains" (0.85 GB) in ord.

            Put this in server/.env:

              SANDBOX_SNAPSHOT="loom-toolchains"
```

Copy that last line into `server/.env`:

```ini
SANDBOX_SNAPSHOT="loom-toolchains"
```

The script is **idempotent**. Run it again and it says:

```
[provision] Snapshot "loom-toolchains" already exists (0.85 GB).
[provision] Nothing to do. Re-run with --force to rebuild it.
```

Use `npm run sandbox:provision -- --force` to rebuild — when adding a toolchain,
say. Note `--force` deletes the existing snapshot **before** building the new
one (the platform will not replace a volume that has snapshots), so a build that
then fails leaves you with no image at all. Only force when you mean it.

### What it does, and why in that order

1. Creates an 8GB **writable volume** from `builtin:debian-13`.
2. Boots a sandbox with that volume as its **root**, at 2GiB and a 15-minute
   timeout — apt is the heaviest thing that will ever run on this image, and
   it is paid for once.
3. Installs `build-essential`, `python3`, `python3-pip`,
   `openjdk-21-jdk-headless`, `ca-certificates` via `sudo -n bash -lc`.
4. Verifies each toolchain **unprivileged**, which is what a real run will be.
5. **Kills the sandbox and waits for the platform to report it stopped.**
6. Freezes the volume into a read-only snapshot.
7. Keeps the 8GB build volume.

Steps 5, 6 and 7 are each there for a reason that cost time to find:

**The kill is not optional, and `await using` does not do it.** Disposal closes
the client's connection and leaves the microVM *running* until its own timeout
expires — verified directly: created in a block, still `status: "running"` four
seconds after scope exit with `stoppedAt: null`. So the snapshot fifteen lines
later fails with `VOLUME_IS_MOUNTED`. Both this script and `run.ts` use
`const sandbox` plus `kill()` in a `finally`, against the SDK skill's advice,
with the reason in a comment at each site.

**The kill's own reply is not trusted.** `kill()` is a DELETE with a ten-second
client-side timeout, and it *does* time out after a heavy apt while still having
taken effect. What is waited on is the platform's own view of the sandbox
turning `stopped`, polled by `waitUntilStopped`.

**The build volume is deliberately kept.** A volume with snapshots cannot be
deleted (`VOLUME_HAS_SNAPSHOTS`), and the snapshot is what you want to keep. So
it stays, at the cost of its 8GB allocation, and `--force` reuses it. Only a run
that produced *no* snapshot cleans up after itself.

### Why `openjdk-21-jdk-headless` and not `default-jdk`

`default-jdk` cannot be installed here, and the error does not say why:

```
Errors were encountered while processing: …systemd-sysv…deb
E: Sub-process /usr/bin/dpkg returned an error code (1)
```

The metapackage pulls the *graphical* JRE, and through it `systemd-sysv` — a
package whose whole job is to install `/sbin/init`. The sandbox already has an
`/sbin/init`: its own 195MB supervisor. dpkg's attempt to replace it fails and
takes the whole transaction down. The headless JDK is 9 packages against 112,
pulls no systemd, and `java`/`javac` are identical.

### Verify it landed

```bash
npm run sandbox:provision      # should say "already exists"
```

Or check the console: **Deploy → Snapshots** should list `loom-toolchains`,
~0.85 GB, region `ord`, bootable.

---

## 6. Run it end to end

```bash
cd server
npm run typecheck    # should be silent
npm run dev
```

Then from the repo root, in another terminal:

```bash
npx expo start
```

In the app: send a message that produces code (*"write a python function that
returns the nth fibonacci number"*), and press **Run** under the fence.

### Check the runner is live without the app

```bash
curl -s localhost:3000/api/v1/execute/status
```

Unauthenticated this returns **401**, which is the correct answer and confirms
the route is behind Clerk — there is no unauthenticated path to an execution
engine. With a session token:

```bash
curl -s localhost:3000/api/v1/execute/status -H "Authorization: Bearer $JWT"
# {"available":true,"languages":["bash","c","c++",…],"timeoutMs":20000,"persistent":true}
```

`available` is the field the app reads to decide whether Run is pressable. If it
is `false`, `DENO_DEPLOY_TOKEN` is not being read — check `server/.env` and
restart `npm run dev`.

### One run, by hand

```bash
curl -s localhost:3000/api/v1/execute \
  -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -d '{"lang":"python","code":"print(\"hello\", 6*7)"}'
```

```json
{"stdout":"hello 42\n","stderr":"","exitCode":0,"timedOut":false,
 "truncated":false,"durationMs":8635,"persisted":true}
```

**~8 seconds is normal** and it is nearly all boot, not your code: create the
VM, mount the volume, write two files, run, read two files back, kill. A second
run is not faster — every press is a fresh VM by design, because a warm pool
would mean one run's leftovers (a background process, a filled disk, a rewritten
`/etc/hosts`) landing in the next one.

### What was verified on this tree

Measured against a live account, all passing:

| Case | Result |
| --- | --- |
| python / cpp / java / c / ts / bash | exit 0, 8.1–11.3s, correct output |
| failing python | exit 1, stdout `before` kept, traceback on stderr |
| shell metacharacters in source | `"hi" > /dev/null; $(echo no)`, backticks — intact |
| unicode | `héllo → 世界 🎉` |
| program printing nothing | `""`, no padding |
| 200k lines of output | `truncated: true`, stdout exactly 20000 chars |
| `while True: pass` | exit **124**, `timedOut: true`, ~28s, **partial output kept** |
| write `/workspace/note.txt`, read it in a later run | `survived` |
| same user pressing Run twice at once | one `persisted: true`, one `false` |
| 3 concurrent runs × 6 rounds | 0 cross-wired |
| `fetch()` from inside a run | `403 Forbidden: this domain is not allowed` |
| raw TCP from inside a run | `ConnectionRefusedError` |
| `Deno.readTextFileSync` in a `ts` run | `NotCapable` |
| `ruby` fence | 400, "Cannot run `ruby` code." |

Sandboxes running after the suite: **0**. No leaked concurrency slots.

---

## 7. How the pieces fit

Six files, three of them tiny.

| File | Role |
| --- | --- |
| `server/scripts/provision-sandbox.ts` | Builds the snapshot. Run once, then never again. |
| `server/src/env.ts` | Parses and validates the `SANDBOX_*` block; exports `sandboxEnabled`. |
| `server/src/sandbox/languages.ts` | The table of fence label → compile/run recipe. |
| `server/src/sandbox/run.ts` | Boots the VM, runs one program, returns what it printed. |
| `server/src/routes/execute.ts` | `POST /api/v1/execute`, `GET /api/v1/execute/status`. |
| `src/components/CodeBlock.tsx` | The Run pill, its states, and the output panel. |

### Adding a language

Three edits, in this order, and the third is the one people forget:

1. Add the package to `INSTALL` in `provision-sandbox.ts`, and a line to
   `VERIFY`. Rebuild with `npm run sandbox:provision -- --force`.
2. Add a recipe to `RECIPES` in `languages.ts` and its fence aliases to
   `BY_LANG`.
3. Add the same aliases to `RUNNABLE` in `src/lib/highlight.ts`.

Skip 3 and the server can run it but no Run button appears. Skip 1 and the
button appears and reports `go: command not found`, which is worse than no
button — which is why `BY_LANG` is deliberately narrower than the syntax
highlighter's alias table. The highlighter maps Go, Rust and Swift onto the
C-like spec because they *colour* the same way; none of that means a compiler is
installed.

### Why output goes through files, not pipes

`stdout: 'piped'` is the obvious way to capture output and it is **not safe with
concurrency**. The SDK keeps its stream registry and the counter it allocates
stream ids from in module-level globals (`esm/stream.js`), shared by every
sandbox connection in the process. Two sandboxes piping at once collide on an id.

Measured, five rounds of three concurrent runs each:

| Approach | Broken rounds |
| --- | --- |
| `stdout: 'piped'` | **1 of 5** |
| files + `fs.readTextFile` | 0 of 5 |

The failure was one run's `output()` never resolving while another returned
*both* runs' stdout merged into a single string, with the SDK logging
`Received stream enqueue for stream ID which does not exist: 0`. A run silently
showing someone else's output is the worst bug this feature could have.

So `run.ts` writes the recipe to `/tmp/loom-io/run.sh`, spawns
`bash -l …/run.sh > out 2> err` with all three stdio set to `null`, trims both
files inside the VM, and reads them back with `fs.readTextFile` — a plain
request/response call that touches none of the stream machinery.

Loading the module twice under different URLs to get separate registries does
not work: Node dedupes the query string away. `0.13.2` is the newest published
version, so there is no upgrade to take instead.

A side benefit: **partial output now survives a timeout kill**, which piping
lost. A program cut off after twenty seconds has usually printed something
first, and that is the most useful thing there is to show.

### Output caps

Two of them, and the ratio between them is load-bearing. Each stream is trimmed
to `MAX_OUTPUT * 4` **bytes** inside the VM, then clipped to `MAX_OUTPUT` = 20000
**characters** in Node. Four is the most bytes UTF-8 ever spends on one
character, so whenever the real output exceeds 20000 characters what comes back
exceeds it too — which is what lets the clip distinguish "cut" from "that was
all there was" and set `truncated` honestly.

The in-VM trim uses `truncate` with a size guard rather than `head -c > copy`:
`truncate` also *grows* a short file, padding with NULs, so `echo hi` would come
back with twenty thousand of them; and a runaway program can leave a file too
large for a second copy to fit.

---

## 8. Limits and cost

The free tier's caps, and what they mean here:

| Plan limit | Value | Relevance |
| --- | --- | --- |
| **Sandbox concurrency** | **5** per organization | The real constraint. Set `SANDBOX_CONCURRENCY=3`. |
| Runtime memory | 768 MB | Probably not about sandboxes — see below. |
| CPU time | 15 CPU hours | Not a concern; see below. |
| Memory time | 350 GiB·h | Not a concern. |
| HTTP requests | 1M | Irrelevant here. |
| Build memory / timeout | 3072 MB / 5 min | Deploy builds, unused by this feature. |

**Concurrency is the one to respect.** Going over does not queue on Deno's side
— `create` fails outright with `SANDBOX_CONCURRENCY_LIMIT_EXCEEDED` (429). That
is why the queue lives in `run.ts`, as a counting semaphore with a 12-deep
waiting list; past that, presses are refused with "try again in a moment" rather
than left on a spinner that will not resolve. `SANDBOX_CONCURRENCY=3` leaves two
slots free: one for `sandbox:provision` to boot while the server is up, one for
a leaked VM not yet reaped.

**"Runtime Memory 768 MB" is not the sandbox memory cap**, as far as can be told
from behaviour: sandboxes created at `1280MiB` ran fine throughout, and the
provision script's `2GiB` VM was accepted too. It most likely governs Deploy
*app* isolates, which this feature does not use — sandbox memory is billed under
the separate "Memory Time" figure. This is inference from observed behaviour, not
documented fact. If a `create` ever comes back rejected on memory, 768MiB is the
number to drop to.

**Usage is negligible.** After building the snapshot and running the entire
verification suite in §6 several times over, the account showed **1.3 of 15 CPU
minutes**, **0.8 of 350 GiB·h**, and 22 of 1M requests. Testing this is not a
budget concern.

**Storage does accumulate.** Each user gets a 400MB volume on first run, plus
the 8GB build volume, and volumes are not in the quota list above. After a test
session with fake user ids you may find a dozen stray `loom-ws-*` volumes; they
are safe to delete at console.deno.com → **Volumes**, keeping
`loom-toolchain-build` (the snapshot needs it) and any volume belonging to a
real user.

---

## 9. Troubleshooting

Every error below is one that actually occurred, with the cause found rather
than guessed.

### `MissingOrgError`

A `ddp_` personal token with no `DENO_DEPLOY_ORG`. Either set the org (the slug
in your console URL) or switch to a `ddo_` organization token, which needs none.
See [§3](#3-get-a-deno-deploy-token).

### `E: List directory /var/lib/apt/lists/partial is missing. - Acquire (13: Permission denied)` — during provision

Two things have to be true, and one of them is a trap.

The sandbox's login user is `app` (uid 1), not root, so apt needs `sudo -n`
(`app` is `NOPASSWD: ALL` in the image's sudoers). But the real cause was the
SDK: **`sandbox.sh` builder chaining discards state.** Each chaining method
builds a *fresh* clone with default state and applies only the current mutation,
so **only the last option in a chain survives**:

```ts
sandbox.sh`…`.sudo().stdout('piped')   // runs WITHOUT sudo
sandbox.sh`…`.stdout('piped').sudo()   // runs WITH sudo, captures nothing
```

Use `sandbox.spawn('sudo', { args: ['-n', 'bash', '-lc', SCRIPT], … })`, which
takes its options in one object and has no such surprise. That is what
`provision-sandbox.ts` does.

### `Sub-process /usr/bin/dpkg returned an error code (1)` mentioning `systemd-sysv`

`default-jdk`. Use `openjdk-21-jdk-headless` — explained in
[§5](#why-openjdk-21-jdk-headless-and-not-default-jdk).

### `The requested volume is currently mounted to one or more sandboxes` (`VOLUME_IS_MOUNTED`)

A sandbox is still running. `await using` does not stop the microVM — see
[§5](#what-it-does-and-why-in-that-order). Kill it explicitly and poll for
`stopped`.

### `Job … could not complete successfully after 3 attempts` (500) on a volume delete

A leftover provision sandbox still holds the volume. Reads like a platform fault
and is not. `killProvisionSandboxes` sweeps them first, filtered on
`{ app: 'loom', purpose: 'provision' }` so the app's own run sandboxes
(`purpose: 'run'`) are never touched.

### `The requested volume has snapshots (such as '…'), and cannot be deleted`

Working as intended. Delete the snapshot first, or keep the volume. `--force`
deletes the old snapshot before touching the volume for exactly this reason.

### `DOMException [TimeoutError]: The operation was aborted due to timeout` from `kill()`

Usually a false alarm: `kill()` has a ten-second client-side timeout and times
out after a heavy apt *while still having worked*. Do not retry it — poll the
platform's status instead.

### `INTERNAL_SERVER_ERROR` from `Volume.create`

`SANDBOX_VOLUME_CAPACITY="300MB"`. Use 400MB or more. The 300MB floor in the
docs does not work in practice.

### `SANDBOX_CONCURRENCY_LIMIT_EXCEEDED` (429)

More than 5 sandboxes alive. Either `SANDBOX_CONCURRENCY` is too high, or
sandboxes are leaking — check **Deploy → Sandboxes** for anything `running`. If
there are strays and no process owns them, they will expire on their own
`timeout` (runs get `SANDBOX_TIMEOUT_MS + 30s`), which is the backstop for a
server that crashed mid-run.

### `The request was malformed: ✖ Must be a valid regional namespaced ID with prefix 'vol_<region>_'`

A volume slug longer than **32 characters**. Past 32 the platform stops treating
the argument as a slug at all and tries to parse it as an id, so the error
describes the wrong kind of argument entirely rather than a name a few characters
too long. `volumeSlugFor` derives its hex budget as `32 - SLUG_PREFIX.length` to
make this unrepresentable.

### Concurrent runs hang, or one shows another's output

The SDK's global stream registry. Fixed on this tree by capturing through files
— see [§7](#why-output-goes-through-files-not-pipes). If you reintroduce
`stdout: 'piped'`, this comes back.

### `Top-level await is currently not supported with the "cjs" output format`

`"type": "module"` is missing from `server/package.json`, or you are running a
script from outside `server/` so a different `package.json` applies.

### Run button greyed out in the app

`GET /api/v1/execute/status` is returning `available: false`, which means
`DENO_DEPLOY_TOKEN` is empty or unreadable. Check `server/.env`, then restart
`npm run dev` — env is read once at boot.

### `python3: command not found` (or gcc, or java) inside a run

`SANDBOX_SNAPSHOT` is empty or names a snapshot that does not exist, so runs are
booting the stock image. `ts` and `bash` fences still work, which is a useful
signal: the stock image has `deno` and a shell and nothing else. Re-check
[§5](#5-build-the-toolchain-snapshot).

---

## 10. Notes for anyone extending this

Three SDK behaviours contradict its own documentation and skill guidance. All
three were established by direct experiment against a live account, and each is
worked around in code with a comment recording the evidence:

1. **`await using` does not terminate the microVM.** It closes the client
   connection; the VM keeps running until its own `timeout`. So it leaks a
   concurrency slot and blocks volume snapshots. Both call sites use explicit
   `kill()` in a `finally` instead.
2. **`sh` builder chaining keeps only the last option.** Use `spawn`.
3. **Stream registries are module-level globals.** Concurrent piped sandboxes
   cross-wire. Capture through the filesystem.

Also stale in the SDK skill: `deno run --allow-none` no longer exists (removed
from Deno in PR #25337). The modern equivalent is *no* `--allow-*` flags at all
plus `--no-prompt` — and `--no-prompt` matters as much as the absent flags,
because without it a denied operation stops and waits for a keypress that never
comes, burning the whole timeout.

Two smaller ones worth knowing: `Sandbox.connect(id)` takes **no region** (the
id carries it — `sbx_ord_…`), and `flattenedSize` reads **0** on a fresh
snapshot, so report `allocatedSize` instead or your 0.85 GB image looks empty.
