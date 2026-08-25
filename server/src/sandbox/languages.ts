/**
 * How each language is compiled and run inside a sandbox.
 *
 * One table rather than a switch in the runner, because it is also the answer to
 * "which fences get a Run button": the client's own allow-list (`isRunnable` in
 * src/lib/highlight.ts) has to agree with this file, and a table is something you
 * can read side by side with that one.
 *
 * The recipes assume the toolchain snapshot built by scripts/provision-sandbox.ts.
 * On the stock image only `deno` exists, so python/c/cpp/java fail on a missing
 * binary until that snapshot is in place and SANDBOX_SNAPSHOT names it.
 */

export type Recipe = {
  /** What the language is called in an error message. */
  label: string;
  /** Filename the source is written to, inside the run directory. */
  file: string;
  /**
   * Shell run with `bash -lc` from the run directory.
   *
   * A script rather than an argv because compiled languages are two steps, and a
   * `&&` between them is what makes a compile error stop before the binary that
   * was not produced. Nothing user-supplied is interpolated here: the source goes
   * in through the filesystem, so this string is a constant per language.
   *
   * `-l` is a login shell, which is what puts /usr/lib/jvm/.../bin on PATH.
   */
  script: string;
};

/**
 * A recipe per runtime, then the aliases that resolve to it.
 *
 * `deno run` is given no `--allow-*` flags at all, so the program cannot read the
 * filesystem, reach the network or spawn anything -- the microVM is the outer
 * boundary and this is the inner one. `--no-prompt` matters as much as the absent
 * flags: without it a denied operation stops and waits for a keypress that is
 * never coming, and the run burns its whole timeout doing nothing.
 *
 * The other three languages are native processes, so they have no equivalent inner
 * boundary and are contained only by the VM. That is the honest limit of this
 * design: a Python script here can open sockets and read /etc, and what stops it
 * mattering is that the machine it is on is disposable and holds nothing.
 */
const RECIPES = {
  deno_ts: {
    label: 'TypeScript',
    file: 'main.ts',
    script: 'deno run --no-prompt --quiet main.ts',
  },
  deno_js: {
    label: 'JavaScript',
    file: 'main.js',
    script: 'deno run --no-prompt --quiet main.js',
  },
  python: {
    label: 'Python',
    file: 'main.py',
    // -u so output arrives unbuffered; a killed run still shows what it printed.
    script: 'python3 -u main.py',
  },
  c: {
    label: 'C',
    file: 'main.c',
    // -O0 because a playground wants the compile to be quick, not the binary.
    script: 'gcc -O0 -std=c17 -o prog main.c -lm && ./prog',
  },
  cpp: {
    label: 'C++',
    file: 'main.cpp',
    script: 'g++ -O0 -std=c++20 -o prog main.cpp && ./prog',
  },
  java: {
    label: 'Java',
    /*
     * The single-file source launcher, which compiles in memory and runs the first
     * class it finds. It is the only form that works here: `javac` insists the
     * filename match the public class, and the class in a chat reply is called
     * whatever the model felt like calling it.
     */
    file: 'Main.java',
    script: 'java Main.java',
  },
  shell: {
    label: 'Shell',
    file: 'main.sh',
    script: 'bash main.sh',
  },
} as const satisfies Record<string, Recipe>;

export type RuntimeId = keyof typeof RECIPES;

/**
 * Fence labels to runtimes.
 *
 * Header labels (`h`, `hpp`) are deliberately absent: a header declares, it does
 * not run, and `gcc -o prog main.h` produces nothing to execute.
 *
 * Narrower than the lexer's alias table on purpose. That one answers "how do I
 * colour this", and it maps Go, Rust, Swift and a dozen others onto the C-like
 * spec because they colour the same way -- none of which means the sandbox has a
 * compiler for them. A Run button that reports `go: command not found` is worse
 * than no Run button, so a language earns its place here only once the snapshot
 * can actually run it.
 */
const BY_LANG: Record<string, RuntimeId> = {
  ts: 'deno_ts', tsx: 'deno_ts', typescript: 'deno_ts',
  js: 'deno_js', jsx: 'deno_js', javascript: 'deno_js', mjs: 'deno_js',
  cjs: 'deno_js', node: 'deno_js',
  py: 'python', python: 'python', python3: 'python',
  c: 'c',
  cpp: 'cpp', 'c++': 'cpp', cc: 'cpp', cxx: 'cpp',
  java: 'java',
  sh: 'shell', bash: 'shell', shell: 'shell', zsh: 'shell',
};

/** The recipe for a fence label, or `null` when nothing here can run it. */
export function recipeFor(lang: string | null | undefined): Recipe | null {
  if (!lang) return null;
  const id = BY_LANG[lang.trim().toLowerCase()];
  return id ? RECIPES[id] : null;
}

/** Every label the executor accepts, for the route's validation message. */
export const supportedLanguages = Object.keys(BY_LANG).sort();
