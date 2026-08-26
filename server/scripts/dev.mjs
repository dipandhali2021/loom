/**
 * `npm run dev`, with the port cleared first.
 *
 * The failure this exists to stop: a dev server that is still holding port 3000
 * when a new one starts. `tsx watch` does not fail loudly in that case -- the app
 * process dies of EADDRINUSE and the watcher stays alive watching files, so the
 * terminal looks busy and healthy while nothing is serving. Worse, a Ctrl+Z'd
 * server keeps its listening socket: the kernel still accepts TCP connections into
 * the backlog, so the phone gets hangs and timeouts rather than a refusal, which
 * looks exactly like a network problem and is not one.
 *
 * So: find whoever holds the port, kill it and the watcher above it, then start.
 */
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PORT = readPort();

/** PORT from server/.env, since env.ts's default and .env can disagree. */
function readPort() {
  if (process.env.PORT) return Number(process.env.PORT);
  try {
    const line = readFileSync(new URL('../.env', import.meta.url), 'utf8')
      .split('\n')
      .find((l) => /^\s*PORT\s*=/.test(l));
    const value = line
      ?.split('=')[1]
      ?.trim()
      .replace(/^["']|["']$/g, '');
    if (value && Number.isFinite(Number(value))) return Number(value);
  } catch {
    // No .env yet is not an error here; env.ts is what enforces that.
  }
  return 3000;
}

const run = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8' }).stdout ?? '';

/**
 * PIDs listening on the port. `ss` first because it is always present on Linux and
 * reports the socket's owner directly; `lsof` covers the case where ss is not.
 */
function listeners() {
  const pids = new Set();

  for (const match of run('ss', ['-ltnpH', `sport = :${PORT}`]).matchAll(/pid=(\d+)/g)) {
    pids.add(Number(match[1]));
  }

  if (pids.size === 0) {
    for (const line of run('lsof', ['-ti', `tcp:${PORT}`, '-sTCP:LISTEN']).split('\n')) {
      if (line.trim()) pids.add(Number(line.trim()));
    }
  }

  pids.delete(process.pid);
  return [...pids];
}

const cmdline = (pid) => {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim();
  } catch {
    return '';
  }
};

const ppid = (pid) => {
  try {
    const status = readFileSync(`/proc/${pid}/status`, 'utf8');
    return Number(/^PPid:\s*(\d+)/m.exec(status)?.[1] ?? 0);
  } catch {
    return 0;
  }
};

/**
 * The watcher above a listener, walked up while the ancestors are still this
 * project's own `tsx watch` shell chain.
 *
 * Killing the listener alone is not enough: its `tsx watch` parent would notice the
 * child exit and respawn it, and that respawn races the server this script is about
 * to start -- one of the two loses the port, at random, which is the same bug with
 * an extra coin flip. Matching on the command string keeps this to our own
 * processes; an unrelated program on the port is killed but its parent is not.
 */
function tree(pid) {
  const chain = [pid];
  let current = ppid(pid);

  while (current > 1) {
    const cmd = cmdline(current);
    if (!/tsx(\/| )watch|tsx watch src\/index\.ts/.test(cmd)) break;
    chain.push(current);
    current = ppid(current);
  }

  return chain;
}

function clearPort() {
  const holders = listeners();
  if (holders.length === 0) return;

  const doomed = [...new Set(holders.flatMap(tree))];
  console.log(`[dev] port ${PORT} is held by pid ${doomed.join(', ')} — clearing it`);

  /*
   * SIGCONT before SIGTERM, and it matters: a stopped process never runs its signal
   * handlers, so a plain SIGTERM would sit pending forever and the port would stay
   * held. Resuming it first is what lets it shut down at all.
   */
  for (const pid of doomed) {
    try {
      process.kill(pid, 'SIGCONT');
      process.kill(pid, 'SIGTERM');
    } catch {
      // Already gone between listing and killing, which is the outcome we wanted.
    }
  }

  // Then SIGKILL whatever is still on the port. index.ts drains for up to 10s on
  // SIGTERM, so this waits past a normal close before forcing it.
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    if (listeners().length === 0) return;
    spawnSync('sleep', ['0.1']);
  }

  for (const pid of [...new Set(listeners().flatMap(tree))]) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* gone */
    }
  }

  spawnSync('sleep', ['0.3']);
  if (listeners().length > 0) {
    console.error(`[dev] port ${PORT} is still held and could not be freed.`);
    console.error(`[dev] Inspect it with: ss -ltnp | grep :${PORT}`);
    process.exit(1);
  }
}

clearPort();

const child = spawn('tsx', ['watch', 'src/index.ts'], { stdio: 'inherit', shell: false });

// Forward signals so Ctrl+C stops the watcher rather than orphaning it under here.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}

child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
