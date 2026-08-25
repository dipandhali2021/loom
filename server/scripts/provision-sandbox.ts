/**
 * Builds the toolchain snapshot the code runner boots from.
 *
 * Run once (`npm run sandbox:provision`), then put the slug it prints into
 * SANDBOX_SNAPSHOT. Everything after that is a read: a snapshot is read-only and
 * mountable by many sandboxes at once, so every Run press boots from this image
 * with gcc, g++, python3 and a JDK already on disk -- no apt-get on the hot path,
 * which is the difference between a run that starts in half a second and one that
 * spends a minute installing a compiler before it can look at the user's code.
 *
 * The shape of it: a writable volume from the built-in Debian image, a sandbox
 * booted on that volume as its root, the installs run inside, the sandbox shut
 * down, and the volume frozen into a snapshot. The shutdown is not optional --
 * the platform refuses to snapshot a volume that is still attached.
 *
 * Safe to re-run. `--force` replaces an existing snapshot, which is how a new
 * toolchain gets added later.
 */

import { Client, Sandbox } from '@deno/sandbox';
import type { Memory } from '@deno/sandbox';

import { env, sandboxEnabled } from '../src/env.ts';

/** Scratch volume, deleted at the end. Its only job is to be snapshotted. */
const VOLUME_SLUG = 'mirai-toolchain-build';
/** Labels on every sandbox this script boots, so a leftover can be found again. */
const PROVISION_LABELS = { app: 'mirai', purpose: 'provision' } as const;
/** Default slug for the result; SANDBOX_SNAPSHOT overrides it. */
const SNAPSHOT_SLUG = env.SANDBOX_SNAPSHOT ?? 'mirai-toolchains';

/**
 * Room for the toolchains plus apt's own caches mid-install.
 *
 * A JDK and build-essential together are well under a gigabyte installed, but
 * apt unpacks before it cleans up, and a volume that fills mid-install fails in a
 * way that reads like a broken package rather than a full disk.
 */
const VOLUME_CAPACITY: Memory = '8GB';

/**
 * The install, as one shell script, run as root.
 *
 * `DEBIAN_FRONTEND=noninteractive` because there is no terminal here to answer a
 * tzdata prompt, and without it the install stops dead on one. `--no-install-recommends`
 * keeps a JDK from dragging in a desktop's worth of suggestions.
 *
 * gcc, g++, python3 and deno are already in `builtin:debian-13`. build-essential and
 * python3-pip go on anyway so the image carries make, headers and pip rather than
 * only the bare compilers. A JDK is the one thing genuinely missing.
 *
 * `openjdk-21-jdk-headless`, not `default-jdk`. The metapackage pulls the *graphical*
 * JRE, and through it systemd-sysv -- a package whose whole job is to install
 * /sbin/init. The sandbox already has an /sbin/init (its own 195MB supervisor), so
 * dpkg's attempt to replace it fails and takes the transaction down with it:
 * "Sub-process /usr/bin/dpkg returned an error code (1)". The headless JDK is 9
 * packages against 112, pulls no systemd, and `javac`/`java` are identical.
 */
const INSTALL = `
set -euxo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  build-essential \
  python3 \
  python3-pip \
  openjdk-21-jdk-headless \
  ca-certificates
# Leave the image smaller than the install left it.
apt-get clean
rm -rf /var/lib/apt/lists/*
`;

/** Prints what each toolchain reports, so a bad image fails here and not in a run. */
const VERIFY = `
set -eux
gcc --version | head -1
g++ --version | head -1
python3 --version
java --version | head -1
deno --version | head -1
`;

const force = process.argv.includes('--force');

/** A failure with a message already written for the person running the script. */
class ProvisionError extends Error {}

/**
 * Aborts the run.
 *
 * A throw rather than `process.exit`, because exiting from inside the `try` skips
 * every `finally` on the way out -- which is how a failed install came to leave both
 * a running sandbox and an eight-gigabyte volume behind, one of them holding a slot
 * of the five the organization gets.
 */
function fail(message: string): never {
  throw new ProvisionError(message);
}

/** Waits, so a retry has a chance of landing on a different answer. */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `work`, retrying a few times with a widening gap.
 *
 * The platform's volume operations are jobs rather than synchronous calls, and one
 * that loses a race with a detach fails outright instead of waiting. Retrying is the
 * documented shape of the fix.
 */
async function retry<T>(work: () => Promise<T>, what: string): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      return await work();
    } catch (error) {
      last = error;
      if (attempt < 4) {
        console.log(`[provision] could not ${what} (attempt ${attempt}); retrying`);
        await sleep(attempt * 5_000);
      }
    }
  }
  throw last;
}

/**
 * Waits for the platform to report a sandbox as stopped.
 *
 * The thing that matters is not that `kill` returned but that the VM has released the
 * volume, and only the platform can answer that. Polling it beats a fixed sleep, which
 * is either too short (VOLUME_IS_MOUNTED on the snapshot) or wasted time.
 */
async function waitUntilStopped(client: Client, id: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const found = (await client.sandboxes.list({ labels: PROVISION_LABELS })).find(
      (sandbox) => sandbox.id === id,
    );
    if (!found || found.status !== 'running') {
      // Stopped, but the detach lands a beat later than the status does.
      await sleep(3_000);
      return;
    }
    await sleep(3_000);
  }
  console.error(`[provision] ${id} is still running; the snapshot may fail`);
}

/**
 * Kills any sandbox this script left running.
 *
 * Filtered on the labels it sets, so a run of the app's own sandboxes -- labelled
 * `purpose: run` -- is never caught by it. An interrupted provision is the normal
 * reason one is here, and each one it leaves behind also occupies one of the five
 * concurrent slots the organization gets.
 */
async function killProvisionSandboxes(client: Client): Promise<void> {
  const live = (await client.sandboxes.list({ labels: PROVISION_LABELS })).filter(
    (sandbox) => sandbox.status === 'running',
  );
  if (live.length === 0) return;

  console.log(`[provision] killing ${live.length} leftover provision sandbox(es)`);
  for (const meta of live) {
    try {
      // No region: `connect` takes none, and the id carries it (sbx_ord_...).
      const sandbox = await Sandbox.connect(meta.id);
      await sandbox.kill();
    } catch (error) {
      console.error(`[provision] could not kill ${meta.id}`, error);
    }
  }
  // The kill returns before the volume is detached; give the platform a moment.
  await sleep(3_000);
}

async function main(): Promise<void> {
  if (!sandboxEnabled) {
    fail(
      'DENO_DEPLOY_TOKEN is not set. Create an organization token at\n' +
        '            console.deno.com -> Settings -> Organization tokens, then put it in\n' +
        '            server/.env as DENO_DEPLOY_TOKEN.',
    );
  }

  const client = new Client();
  const region = env.SANDBOX_REGION;

  console.log(`[provision] region ${region}`);
  console.log(`[provision] snapshot slug ${SNAPSHOT_SLUG}`);

  const existing = await client.snapshots.get(SNAPSHOT_SLUG);
  if (existing && !force) {
    console.log(
      `\n[provision] Snapshot "${SNAPSHOT_SLUG}" already exists (${(existing.allocatedSize / 1e9).toFixed(2)} GB).\n` +
        `[provision] Nothing to do. Re-run with --force to rebuild it.\n`,
    );
    return;
  }

  /*
   * Slugs are one namespace across volumes and snapshots, so a leftover build
   * volume from an interrupted run blocks the create. Clearing it is safe: this
   * volume is scratch by construction and holds nothing but a half-finished apt.
   */
  /*
   * On `--force` the old snapshot goes first, before anything touches the volume.
   *
   * Not for tidiness: the platform refuses to delete a volume that has snapshots, and
   * the build volume is kept between runs precisely because it has one. So the
   * snapshot has to be gone before the volume it was cut from can be replaced. The
   * cost is that a build which then fails leaves no image at all -- which is why this
   * only happens when `--force` was asked for explicitly.
   */
  if (existing) {
    console.log(`[provision] --force: deleting the old "${SNAPSHOT_SLUG}"`);
    await client.snapshots.delete(existing.id);
  }

  const stale = await client.volumes.get(VOLUME_SLUG);
  if (stale) {
    /*
     * A volume cannot be deleted while a sandbox holds it, and an interrupted run
     * leaves exactly that: a live sandbox with this volume as its root. The delete
     * comes back as a 500 ("Job ... could not complete successfully after 3
     * attempts"), which reads like a platform fault but is really this. So sweep the
     * provision sandboxes first -- they are labelled, so nothing else is touched.
     */
    await killProvisionSandboxes(client);

    console.log('[provision] removing a leftover build volume');
    /*
     * Retried, because the kill above returns before the platform has finished
     * detaching the volume, and the first delete after it can still be refused.
     */
    await retry(() => client.volumes.delete(stale.id), 'delete the leftover volume');
    /*
     * Deletion frees the slug at once but keeps the block storage for a grace
     * period, so an immediate create with the same slug can still be refused. A
     * short wait is cheaper than telling the user to come back tomorrow.
     */
    await sleep(5_000);
  }

  console.log('[provision] creating a bootable volume from builtin:debian-13');
  const volume = await client.volumes.create({
    slug: VOLUME_SLUG,
    region,
    capacity: VOLUME_CAPACITY,
    from: 'builtin:debian-13',
  });

  // Set once the snapshot exists, which changes what cleanup is allowed to do.
  let snapshotted = false;

  try {
    /*
     * Scoped so the sandbox is gone before the snapshot is attempted: the platform
     * refuses to snapshot a volume that is still attached to one.
     *
     * `kill()` in a `finally`, not `await using`. Disposal closes the client
     * connection and leaves the microVM running until its own timeout expires -- so
     * `await using` alone gets "The requested volume is currently mounted to one or
     * more sandboxes" from the snapshot fifteen lines later.
     */
    {
      console.log('[provision] booting a sandbox on it (writable root)');
      const sandbox = await Sandbox.create({
        region,
        root: volume.slug,
        /*
         * Bigger than a run gets: apt is the heaviest thing that will ever happen on
         * this image, and it is paid for once.
         */
        memory: '2GiB',
        // Long enough for a cold apt over a slow mirror, and no longer.
        timeout: '15m',
        labels: PROVISION_LABELS,
      });

      try {
        console.log('[provision] installing build-essential, python3, default-jdk');
        console.log('[provision] (this is the slow part -- a few minutes is normal)\n');

        /*
         * `spawn` rather than the `sh` template builder.
         *
         * The builder's chaining methods each clone the command and then drop the
         * clone's state, so only the last option in a chain survives -- `.sudo()`
         * followed by `.stdout('inherit')` runs without sudo, which is how apt came to
         * fail with "Permission denied" on /var/lib/apt/lists. `spawn` takes its
         * options in one object and has no such surprise.
         *
         * `sudo -n` because the sandbox's login user is `app` (uid 1) and apt writes
         * all over /var; `app` is NOPASSWD ALL in the image's sudoers, and `-n` makes a
         * missing rule fail fast instead of waiting on a password prompt. `inherit` so
         * the apt log streams here rather than arriving all at once at the end.
         */
        const install = await sandbox.spawn('sudo', {
          args: ['-n', 'bash', '-lc', INSTALL],
          stdin: 'null',
          stdout: 'inherit',
          stderr: 'inherit',
        });
        const installed = await install.output();

        if (!installed.status.success) {
          fail(
            `The install failed with exit code ${installed.status.code}. Nothing was snapshotted.`,
          );
        }

        console.log('\n[provision] verifying the toolchains');
        // Piped, unlike the install above: this output is reformatted before printing.
        // Unprivileged on purpose -- it checks what a *run* will be able to reach.
        const verify = await sandbox.spawn('bash', {
          args: ['-lc', VERIFY],
          stdin: 'null',
          stdout: 'piped',
          stderr: 'piped',
        });
        const versions = await verify.output();
        if (!versions.status.success) {
          fail(
            `Verification failed with exit code ${versions.status.code}:\n` +
              `${versions.stderrText ?? '(no output)'}`,
          );
        }
        const reported = (versions.stdoutText ?? '').trim().split('\n');
        console.log(reported.map((line) => `           ${line}`).join('\n'));
      } finally {
        console.log('[provision] shutting the sandbox down to release the volume');
        /*
         * `kill` is a DELETE with a ten-second client-side timeout, and it does time
         * out on a sandbox that has just finished a heavy apt -- while still having
         * taken effect. So the request is not trusted either way: what is waited on is
         * the platform's own view of the sandbox turning to `stopped`.
         */
        await sandbox.kill().catch(() => {});
        await waitUntilStopped(client, sandbox.id);
      }
    }

    console.log('[provision] freezing the volume into a snapshot');
    // Retried: the detach above is asynchronous on the platform's side, so the first
    // attempt can still come back VOLUME_IS_MOUNTED.
    const snapshot = await retry(
      () => client.volumes.snapshot(volume.id, { slug: SNAPSHOT_SLUG }),
      'snapshot the volume',
    );
    snapshotted = true;

    /*
     * `allocatedSize`, not `flattenedSize`. The flattened figure is what the image
     * would weigh with every base layer folded in, and on a snapshot this fresh the
     * platform has not computed it yet -- it reads 0, which looks like an empty
     * snapshot rather than an unfinished sum.
     */
    console.log(
      `\n[provision] Done. Snapshot "${snapshot.slug}" ` +
        `(${(snapshot.allocatedSize / 1e9).toFixed(2)} GB) in ${snapshot.region}.\n\n` +
        `            Put this in server/.env:\n\n` +
        `              SANDBOX_SNAPSHOT="${snapshot.slug}"\n`,
    );
  } finally {
    /*
     * The build volume is kept, not deleted.
     *
     * A snapshot is not independent of the volume it was cut from -- the platform
     * refuses the delete with VOLUME_HAS_SNAPSHOTS until the snapshot goes first,
     * which is exactly backwards from what is wanted. So it stays, at the cost of its
     * 8GB allocation, and `--force` reuses it on the next build.
     *
     * Only a run that produced no snapshot cleans up after itself: there is nothing
     * to protect then, and leaving a half-installed volume behind would mean the next
     * run resumes from it.
     */
    if (snapshotted) {
      console.log(`[provision] keeping ${volume.slug} (the snapshot is built on it)`);
    } else {
      console.log('[provision] removing the build volume');
      await killProvisionSandboxes(client);
      await retry(() => client.volumes.delete(volume.id), 'delete the build volume').catch(
        (error: unknown) => {
          console.error(
            `[provision] could not delete ${volume.slug}; remove it by hand at console.deno.com`,
            error,
          );
        },
      );
    }
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof ProvisionError) {
    console.error(`\n[provision] ${error.message}\n`);
  } else {
    console.error('\n[provision] Unexpected failure:\n', error);
  }
  process.exitCode = 1;
}
