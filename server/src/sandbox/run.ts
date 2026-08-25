import { Sandbox, Volume } from '@deno/sandbox';

import { env } from '../env.ts';
import { recipeFor } from './languages.ts';

/**
 * Runs one code block in a Deno Sandbox: a Firecracker microVM per press of Run,
 * booted from a snapshot that already carries the toolchains, destroyed as soon as
 * the program exits.
 *
 * A fresh VM per run rather than a warm pool. It boots in a fraction of a second,
 * and a pool would mean one run's leftovers -- a background process, a rewritten
 * /etc/hosts, a filled disk -- landing in the next one. The only thing that
 * deliberately survives a run is the user's own volume at /workspace.
 */

/** Mount point for the per-user volume, and the parent of every run directory. */
const WORKSPACE = '/workspace';
/** Where a run goes when it has no volume: ephemeral, gone with the VM. */
const SCRATCH = '/tmp/mirai';

/**
 * Ceiling on each stream, in characters.
 *
 * A `while (true) console.log()` produces far more output than the timeout takes to
 * expire, and nothing past the first screenful of it tells the person who pressed
 * Run anything. Cutting it keeps it out of the JSON body, the client's state and the
 * transcript's layout pass.
 */
const MAX_OUTPUT = 20_000;

/**
 * Where a run's stdout and stderr are collected, inside the VM.
 *
 * Under /tmp rather than the workspace: output is a by-product of one press, and
 * putting it on the persistent volume would spend the user's 400MB on it and leave
 * the previous run's output sitting there for the next one to read.
 */
const IO = '/tmp/mirai-io';

/**
 * Bytes of each stream kept in the VM, before it is read back and clipped.
 *
 * Four per character, which is the most UTF-8 ever spends on one, so that whenever
 * the real output is longer than `MAX_OUTPUT` characters what comes back is longer
 * too -- that is what lets `clip` tell "cut" from "this is all there was". Cutting on
 * a byte boundary can leave half a character at the end, and it lands past
 * `MAX_OUTPUT`, so `clip` discards it.
 */
const IO_CAP = MAX_OUTPUT * 4;

/** The recipe, written to a file rather than nested inside the command line. */
const RUNNER = 'run.sh';

/**
 * Shrinks both output files to `IO_CAP`, in place.
 *
 * `truncate` rather than `head -c > copy`, because a program that prints without
 * stopping can leave a file large enough that a second copy of it does not fit, and
 * the run whose output could not be copied is exactly the run whose first few
 * thousand lines are worth reading.
 *
 * The `-gt` guard matters: `truncate` also *grows* a short file to the size given,
 * padding it with NULs, which would append twenty thousand of them to `echo hi`.
 */
const TRIM = `
for name in out err; do
  file=${IO}/$name
  [ -f "$file" ] || : > "$file"
  if [ "$(stat -c%s "$file")" -gt ${IO_CAP} ]; then truncate -s ${IO_CAP} "$file"; fi
done
exit 0
`;

/**
 * How long boot may take before the attempt is abandoned.
 *
 * Separate from the program's own budget: a slow create is a platform problem and
 * should not eat the seconds the user's code was promised.
 */
const BOOT_TIMEOUT_MS = 30_000;

/** The exit code reported when the wall clock, not the program, ended the run. */
const TIMEOUT_CODE = 124;

export type RunOutcome = {
  stdout: string;
  stderr: string;
  /** Negative when a signal ended it; `TIMEOUT_CODE` when the deadline did. */
  exitCode: number;
  /** True when the deadline fired rather than the program finishing. */
  timedOut: boolean;
  /** True when either stream was cut at `MAX_OUTPUT`. */
  truncated: boolean;
  /** Wall clock for the whole thing, boot included -- which is what was waited. */
  durationMs: number;
  /** Whether this run had the persistent workspace mounted. */
  persisted: boolean;
};

/** Raised for anything the caller should turn into a 4xx rather than a 500. */
export class RunRejected extends Error {}

function clip(text: string | null): { text: string; truncated: boolean } {
  const value = text ?? '';
  if (value.length <= MAX_OUTPUT) return { text: value, truncated: false };
  return { text: value.slice(0, MAX_OUTPUT), truncated: true };
}

/**
 * How many presses may be waiting for a slot before the rest are turned away.
 *
 * Without a cap a burst queues without bound, and every request in that queue is a
 * held-open HTTP connection whose user is watching a spinner that will not resolve
 * for a minute. Refusing the tail with "try again" is the honest answer.
 */
const MAX_QUEUED = 12;

/**
 * A counting semaphore over sandbox slots.
 *
 * Deno Deploy allows a fixed number of sandboxes per organization -- five during
 * the pre-release -- and going over it fails `create` outright rather than queueing
 * on their side. So the queue lives here, where a wait is cheap and the failure
 * mode is a wait rather than an error.
 */
class Slots {
  #free: number;
  #waiting: (() => void)[] = [];

  constructor(count: number) {
    this.#free = count;
  }

  get queued(): number {
    return this.#waiting.length;
  }

  async take(): Promise<void> {
    if (this.#free > 0) {
      this.#free -= 1;
      return;
    }
    if (this.#waiting.length >= MAX_QUEUED) {
      throw new RunRejected('The code runner is busy. Try again in a moment.');
    }
    await new Promise<void>((resolve) => this.#waiting.push(resolve));
  }

  /** Hands the slot straight to the next waiter, so it is never briefly free. */
  release(): void {
    const next = this.#waiting.shift();
    if (next) next();
    else this.#free += 1;
  }
}

const slots = new Slots(env.SANDBOX_CONCURRENCY);

/**
 * Users whose workspace volume is attached to a live sandbox right now.
 *
 * A volume can be mounted by one sandbox at a time, so a second press by the same
 * user cannot have it. That press runs ephemerally instead of waiting: waiting
 * would stall it behind a run that may have twenty seconds left, and a run without
 * /workspace still does the thing the user asked for -- it just cannot see files an
 * earlier run left behind.
 */
const volumeInUse = new Set<string>();

/** Prefix on every workspace volume, so one is recognisable in the Deploy dashboard. */
const SLUG_PREFIX = 'mirai-ws-';

/**
 * The most hex a slug has room for after the prefix.
 *
 * Slugs run to 32 characters, and going one over does not produce a helpful error:
 * the platform stops treating the argument as a slug at all and tries to parse it as
 * an id, so the reply is "Must be a valid regional namespaced ID with prefix
 * 'vol_<region>_'" -- which reads like the wrong sort of argument entirely rather
 * than a name three characters too long.
 */
const SLUG_HEX = 32 - SLUG_PREFIX.length;

/**
 * A volume slug for a user, derived from their row id.
 *
 * The platform's rules are narrow -- 2-32 characters of `[a-z0-9-]`, no leading,
 * trailing or doubled hyphen -- and a UUID with its dashes in is both too long and
 * the wrong shape, so the hex is taken bare. Twenty-three hex characters is 92 bits,
 * far more than enough to keep two users apart.
 */
export function volumeSlugFor(userId: string): string {
  const hex = userId
    .replace(/[^a-f0-9]/gi, '')
    .toLowerCase()
    .slice(0, SLUG_HEX);
  // A non-hex id (a cuid, say) can come back short; pad so the slug stays legal.
  return `${SLUG_PREFIX}${hex.padEnd(8, '0')}`;
}

/**
 * The user's workspace volume, created on first run.
 *
 * `get` before `create`, because create fails on a slug that already exists and
 * every run after the first takes that path. Any failure here degrades to `null`
 * rather than throwing: a quota, a region mismatch or a 24-hour deletion grace
 * period should cost the user persistence, not the ability to run anything.
 */
async function workspaceVolume(userId: string): Promise<string | null> {
  const slug = volumeSlugFor(userId);
  try {
    const existing = await Volume.get(slug);
    if (existing) return existing.slug;
  } catch (error) {
    console.error('[sandbox] volume lookup failed; running without /workspace', error);
    return null;
  }

  try {
    const created = await Volume.create({
      slug,
      region: env.SANDBOX_REGION,
      capacity: env.SANDBOX_VOLUME_CAPACITY,
    });
    return created.slug;
  } catch (error) {
    /*
     * Two first runs by the same user can race here and one loses on the slug. That
     * is a normal outcome rather than a fault, and the loser has a working volume
     * waiting for it -- but it is already mounted by the winner, so this press runs
     * ephemerally and the next one picks it up.
     */
    console.error('[sandbox] volume create failed; running without /workspace', error);
    return null;
  }
}

/**
 * The sandbox's own lifetime, as a little more than the program's budget.
 *
 * Belt and braces for the case the process here dies between `create` and the
 * disposal that would have torn the VM down: the platform reaps it on this deadline
 * regardless, so a crashed server cannot leak a slot until someone notices.
 */
const sandboxLifetime = (): `${number}s` => `${Math.ceil(env.SANDBOX_TIMEOUT_MS / 1000) + 30}s`;

/**
 * Stops a sandbox, and does not care whether the request said so.
 *
 * `kill` is a DELETE with a ten-second client-side timeout of its own, and it does
 * sometimes time out on a VM that has just been working hard -- while still having
 * taken effect. Reporting that as a failure would be noise, and retrying it would be
 * worse. The sandbox's own `timeout` is the backstop either way.
 */
async function shutDown(sandbox: Sandbox): Promise<void> {
  try {
    await sandbox.kill();
  } catch (error) {
    console.error('[sandbox] kill failed; the platform timeout will collect it', error);
  }
}

/**
 * Reads one captured stream back out of the VM.
 *
 * Trimmed inside the sandbox first, because a runaway program can leave a file of
 * hundreds of megabytes and pulling all of it over the wire to throw away all but
 * the first twenty thousand characters would cost far more than the run did.
 *
 * A missing file means the shell never got as far as creating it -- a boot that went
 * wrong, or a kill that landed first -- and an empty string is the honest answer for
 * a run that printed nothing anyway.
 */
async function readStream(sandbox: Sandbox, name: 'out' | 'err'): Promise<string> {
  try {
    const trim = await sandbox.spawn('bash', {
      args: ['-lc', TRIM],
      stdin: 'null',
      stdout: 'null',
      stderr: 'null',
    });
    await trim.output();
    return await sandbox.fs.readTextFile(`${IO}/${name}`);
  } catch (error) {
    console.error(`[sandbox] could not read ${name}`, error);
    return '';
  }
}

/** `Sandbox.create`, with a deadline of its own so a slow boot cannot hang a request. */
async function boot(root: string | undefined, volume: string | null): Promise<Sandbox> {
  const created = Sandbox.create({
    region: env.SANDBOX_REGION,
    memory: env.SANDBOX_MEMORY,
    timeout: sandboxLifetime(),
    ...(root ? { root } : {}),
    ...(volume ? { volumes: { [WORKSPACE]: volume } } : {}),
    /*
     * No egress. The code being run arrived from a chat reply and has no business
     * reaching the network, and cutting it off here covers the three native
     * toolchains too -- `deno run` has its own permission boundary, gcc and python3
     * have none at all.
     */
    allowNet: [],
    labels: { app: 'mirai', purpose: 'run' },
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Sandbox did not start within ${BOOT_TIMEOUT_MS}ms`)),
      BOOT_TIMEOUT_MS,
    );
  });

  try {
    return await Promise.race([created, deadline]);
  } catch (error) {
    /*
     * The create may still land after the deadline won the race, and by then nobody
     * holds the sandbox. Killing it when it arrives matters more than it looks: a
     * leaked VM occupies one of the organization's five concurrent slots for its whole
     * lifetime, so a run of slow boots would lock every user out.
     */
    void created.then(shutDown).catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs `code` and returns what it printed.
 *
 * `userId` decides which workspace volume is mounted; `signal` is the client's own
 * abort, so navigating away from a reply stops paying for its sandbox.
 */
export async function runCode({
  code,
  lang,
  userId,
  signal,
}: {
  code: string;
  lang: string;
  userId: string;
  signal?: AbortSignal;
}): Promise<RunOutcome> {
  const recipe = recipeFor(lang);
  if (!recipe) throw new RunRejected(`Cannot run \`${lang}\` code.`);

  const started = Date.now();
  await slots.take();

  /*
   * Claimed before boot and released in the outermost `finally`, so the window in
   * which this user's volume is considered busy covers the whole time it is actually
   * attached. Claiming it later would let a second press mount it mid-boot.
   *
   * The claim is taken *before* the first `await`, not after. Testing it and then
   * awaiting `workspaceVolume` would let two presses by the same user both pass the
   * test in the same tick and both go on to mount -- which is the thing this set
   * exists to prevent, and it does not fail loudly: both runs report `persisted`
   * while the second sits waiting on the mount.
   */
  const claimed = env.SANDBOX_PERSIST && !volumeInUse.has(userId);
  if (claimed) volumeInUse.add(userId);

  let slug: string | null = null;
  try {
    if (claimed) slug = await workspaceVolume(userId);
  } finally {
    // The claim was speculative; drop it if there turned out to be no volume to hold.
    if (claimed && !slug) volumeInUse.delete(userId);
  }

  try {
    signal?.throwIfAborted();

    /*
     * `kill()` in a `finally`, not `await using`.
     *
     * Disposal closes the client's connection to the sandbox and leaves the microVM
     * running until its own timeout expires. With `await using` alone every press
     * would hold a slot for the best part of a minute after it finished, and the sixth
     * concurrent run in that window fails outright with
     * SANDBOX_CONCURRENCY_LIMIT_EXCEEDED rather than queueing.
     */
    const sandbox = await boot(env.SANDBOX_SNAPSHOT, slug);
    try {
      // On a mounted volume this is the mount point, which already exists; on the
      // ephemeral path it does not. `recursive` covers both without a branch.
      const cwd = slug ? WORKSPACE : SCRATCH;
      await sandbox.fs.mkdir(cwd, { recursive: true });
      await sandbox.fs.writeTextFile(`${cwd}/${recipe.file}`, code);

      /*
       * The recipe goes to a file too, instead of being passed as `bash -lc <script>`.
       * The command line already carries one level of shell quoting for the redirect
       * that captures the output, and nesting a second level inside it is a way to get
       * a recipe subtly mangled by a quote it did not expect.
       */
      await sandbox.fs.mkdir(IO, { recursive: true });
      await sandbox.fs.writeTextFile(`${IO}/${RUNNER}`, recipe.script);

      /*
       * One controller for both reasons a run can be cut short: the deadline and the
       * client hanging up. `spawn`'s signal sends SIGTERM, and the VM going away a
       * moment later is what handles a process that ignores it.
       */
      const stop = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        stop.abort();
      }, env.SANDBOX_TIMEOUT_MS);
      const hangUp = () => stop.abort();
      signal?.addEventListener('abort', hangUp);

      try {
        /*
         * Output goes to files in the VM and is read back afterwards, rather than
         * being piped through the SDK.
         *
         * `stdout: 'piped'` is the obvious way to do this and it is not safe here.
         * The SDK keeps its stream registry -- and the counter it allocates stream
         * ids from -- in module-level globals in esm/stream.js, shared by every
         * sandbox connection in the process. Two sandboxes piping at once therefore
         * collide on an id: measured over five rounds of three concurrent runs, one
         * round had a run whose `output()` never resolved while another returned both
         * runs' stdout merged into one string, with the SDK logging "Received stream
         * enqueue for stream ID which does not exist: 0". A run silently showing
         * someone else's output is the worst failure this file could have. The same
         * test through files was clean, and 0.13.2 is the newest published version,
         * so there is no upgrade to take instead.
         *
         * `fs.readTextFile` is a plain request/response call and touches none of
         * that, so the run's own bytes are the only thing that can come back.
         */
        const child = await sandbox.spawn('bash', {
          // `-l` for the login shell that puts the JDK on PATH; `-c` for the redirect.
          args: ['-lc', `bash -l ${IO}/${RUNNER} > ${IO}/out 2> ${IO}/err`],
          cwd,
          // Closed rather than piped: a program that reads stdin gets EOF immediately
          // instead of blocking until the deadline on input that is never coming.
          stdin: 'null',
          // Discarded, so nothing is piped even for a run that has no competition.
          stdout: 'null',
          stderr: 'null',
          signal: stop.signal,
        });

        const status = await child.output();

        /*
         * Read even when the run was killed. A program cut off by the deadline has
         * usually printed something first, and that partial output is the most useful
         * thing there is to show for a run that hit a twenty-second wall.
         */
        const out = clip(await readStream(sandbox, 'out'));
        const err = clip(await readStream(sandbox, 'err'));

        return {
          stdout: out.text,
          stderr: err.text,
          exitCode: timedOut ? TIMEOUT_CODE : status.status.code,
          timedOut,
          truncated: out.truncated || err.truncated,
          durationMs: Date.now() - started,
          persisted: slug !== null,
        };
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', hangUp);
      }
    } finally {
      /*
       * Before the volume claim is dropped and the slot handed on: the next run to
       * take either of them needs this VM actually gone, not merely disconnected.
       */
      await shutDown(sandbox);
    }
  } finally {
    if (slug) volumeInUse.delete(userId);
    slots.release();
  }
}

/** For the route's own diagnostics: how many presses are currently waiting. */
export const queueDepth = (): number => slots.queued;
