/**
 * Syntax highlighting for fenced code blocks.
 *
 * Hand-rolled for the same reason the Markdown parser is: everything on offer
 * assumes a DOM. The RN highlighters that exist either ship a WebView or ship a
 * grammar engine and a megabyte of language definitions, and neither is worth it
 * for the handful of languages a chat model actually emits.
 *
 * What this is: one scanner over the source, driven by a small per-language spec.
 * It is a lexer and nothing more -- no parse tree, no scope resolution -- which is
 * the right depth for colour. `foo(` reads as a call because of the paren after
 * it, not because anything knows what `foo` is, and that is accurate often enough
 * to look correct and cheap enough to re-run while a reply streams.
 *
 * Tolerant of half-written input by design: an unclosed string or comment runs to
 * the end of the text rather than failing, because mid-stream that is the normal
 * case, exactly as with an unclosed `**` in the Markdown parser.
 */

export type TokenKind =
  | 'plain'
  | 'comment'
  | 'string'
  | 'number'
  | 'keyword'
  | 'builtin'
  | 'func'
  | 'operator'
  | 'punct'
  /** Decorators, annotations, preprocessor lines -- `@override`, `#include`. */
  | 'meta';

export type Token = { text: string; kind: TokenKind };

export type SyntaxPalette = Record<TokenKind, string>;

/**
 * The two syntax themes.
 *
 * These live beside the scanner rather than in `theme/tokens.ts` because they are
 * keyed by `TokenKind` -- the tokens are the palette's shape, so keeping them
 * together avoids a token module that has to import from `lib` to describe itself.
 */
export const darkSyntax: SyntaxPalette = {
  plain: '#E6E7EB',
  comment: '#6F7681',
  string: '#9FD08A',
  number: '#F0A46A',
  keyword: '#C792EA',
  builtin: '#5FC8D0',
  func: '#8AB4F8',
  operator: '#F07EA8',
  punct: '#B6BAC4',
  meta: '#E5C07B',
};

export const lightSyntax: SyntaxPalette = {
  plain: '#24292F',
  comment: '#6E7781',
  string: '#0A3069',
  number: '#0550AE',
  keyword: '#CF222E',
  builtin: '#0550AE',
  func: '#8250DF',
  operator: '#CF222E',
  punct: '#57606A',
  meta: '#953800',
};

type StringRule = {
  open: string;
  /** Usually the same as `open`; different for things like `<<'EOF'`. */
  close: string;
  /** False for quotes a newline terminates, as in most single-quoted forms. */
  multiline: boolean;
  /** Whether a backslash escapes the closer. */
  escape: boolean;
};

type Spec = {
  lineComment: string[];
  blockComment: [string, string][];
  /** Longest opener first: `"""` has to be tried before `"`. */
  strings: StringRule[];
  keywords: Set<string>;
  builtins: Set<string>;
  /** Words after which the next identifier is a definition, so it reads as a call. */
  defines: Set<string>;
  /** Leading character that makes the rest of the word an annotation. */
  meta: string | null;
};

const set = (words: string) => new Set(words.split(/\s+/).filter(Boolean));

const quote = (open: string, multiline = false): StringRule => ({
  open,
  close: open,
  multiline,
  escape: true,
});

const JS_KEYWORDS = `
  abstract as async await break case catch class const continue debugger declare default delete do else enum
  export extends false finally for from function get global if implements import in infer instanceof interface is
  keyof let new null of package private protected public readonly require return satisfies set static super switch
  this throw true try type typeof undefined var void while with yield namespace
`;

const JS_BUILTINS = `
  Array Boolean Date Error JSON Map Math Number Object Promise Proxy Reflect RegExp Set String Symbol WeakMap
  WeakSet console document fetch globalThis process window structuredClone parseInt parseFloat isNaN
  setTimeout setInterval clearTimeout clearInterval
`;

const PY_KEYWORDS = `
  and as assert async await break class continue def del elif else except False finally for from global if import
  in is lambda match None nonlocal not or pass raise return True try while with yield case
`;

const PY_BUILTINS = `
  abs all any bool bytes callable dict dir enumerate filter float format frozenset getattr hasattr hash id input
  int isinstance issubclass iter len list map max min next object open ord print range repr reversed round self
  set setattr slice sorted str sum super tuple type vars zip
`;

/**
 * One keyword set for every brace language.
 *
 * Deliberately a union rather than a set per language: Rust's `fn` and Java's
 * `implements` never appear in the same file, so colouring both costs nothing,
 * and the alternative is a dozen near-identical lists to maintain for a
 * difference nobody can see.
 */
const CLIKE_KEYWORDS = `
  abstract alignas asm assert auto base bool break byte case catch chan char class const constexpr continue crate
  decltype default defer delegate delete do double dyn else enum explicit extends extern false final finally float
  fn for foreach friend func go goto if impl implements import in inline int int32 int64 interface internal let
  long loop match mod module move mut mutable namespace new nil nullptr operator out override package private
  protected pub public range record ref register reinterpret_cast return sealed self short signed sizeof static
  static_cast str string struct super switch synchronized template this throw throws trait transient true try type
  typedef typeid typename uint uint32 uint64 union unsafe unsigned use using val var virtual void volatile when
  where while with yield
`;

const SHELL_KEYWORDS = `
  case do done elif else esac fi for function if in local return select then time until while
`;

const SHELL_BUILTINS = `
  awk cat cd chmod cp curl cut date echo env exit export find git grep head kill ls make mkdir mv npm printf pwd
  read rm sed set sh sleep sort source sudo tail tar test touch tr uniq unset wc wget which xargs yarn
`;

const SQL_KEYWORDS = `
  all alter and as asc between by case cast column create cross default delete desc distinct drop else end exists
  foreign from full group having if in index inner insert into is join key left like limit not null offset on or
  order outer primary references right select set table then union unique update values view when where with
`;

const CSS_KEYWORDS = `
  and from important media keyframes import supports not only to
`;

const BASE: Omit<Spec, 'keywords' | 'builtins'> = {
  lineComment: ['//'],
  blockComment: [['/*', '*/']],
  strings: [quote('"'), quote("'"), quote('`', true)],
  defines: set('function class def fn struct enum interface type trait impl'),
  meta: '@',
};

const SPECS: Record<string, Spec> = {
  js: { ...BASE, keywords: set(JS_KEYWORDS), builtins: set(JS_BUILTINS) },
  python: {
    lineComment: ['#'],
    blockComment: [],
    // Triple quotes first: `"""` has to win over `"` or a docstring closes at once.
    strings: [quote('"""', true), quote("'''", true), quote('"'), quote("'")],
    keywords: set(PY_KEYWORDS),
    builtins: set(PY_BUILTINS),
    defines: set('def class'),
    meta: '@',
  },
  clike: { ...BASE, keywords: set(CLIKE_KEYWORDS), builtins: set('') },
  shell: {
    lineComment: ['#'],
    blockComment: [],
    strings: [quote('"'), quote("'")],
    keywords: set(SHELL_KEYWORDS),
    builtins: set(SHELL_BUILTINS),
    defines: set('function'),
    meta: null,
  },
  json: {
    lineComment: [],
    blockComment: [],
    strings: [quote('"')],
    keywords: set('true false null'),
    builtins: set(''),
    defines: set(''),
    meta: null,
  },
  css: {
    lineComment: ['//'],
    blockComment: [['/*', '*/']],
    strings: [quote('"'), quote("'")],
    keywords: set(CSS_KEYWORDS),
    builtins: set(''),
    defines: set(''),
    meta: '@',
  },
  sql: {
    lineComment: ['--'],
    blockComment: [['/*', '*/']],
    strings: [quote("'"), quote('"')],
    keywords: set(SQL_KEYWORDS),
    builtins: set(''),
    defines: set(''),
    meta: null,
  },
  /**
   * Anything unrecognised. Both common comment markers, quotes, numbers and
   * operators still colour, which is most of what makes a block readable -- only
   * the keywords are missing, and guessing those across unknown languages would
   * paint the wrong words.
   */
  text: {
    lineComment: ['#', '//'],
    blockComment: [['/*', '*/']],
    strings: [quote('"'), quote("'")],
    keywords: set(''),
    builtins: set(''),
    defines: set(''),
    meta: null,
  },
};

const ALIASES: Record<string, keyof typeof SPECS> = {
  js: 'js', jsx: 'js', javascript: 'js', mjs: 'js', cjs: 'js', node: 'js',
  ts: 'js', tsx: 'js', typescript: 'js',
  py: 'python', python: 'python', python3: 'python', ipython: 'python',
  c: 'clike', h: 'clike', cpp: 'clike', 'c++': 'clike', cc: 'clike', hpp: 'clike',
  cs: 'clike', 'c#': 'clike', csharp: 'clike', java: 'clike', kotlin: 'clike', kt: 'clike',
  swift: 'clike', go: 'clike', golang: 'clike', rust: 'clike', rs: 'clike', dart: 'clike',
  scala: 'clike', php: 'clike', groovy: 'clike', objc: 'clike', zig: 'clike',
  sh: 'shell', bash: 'shell', zsh: 'shell', shell: 'shell', console: 'shell', fish: 'shell',
  json: 'json', jsonc: 'json', json5: 'json',
  css: 'css', scss: 'css', sass: 'css', less: 'css',
  sql: 'sql', postgres: 'sql', postgresql: 'sql', mysql: 'sql', sqlite: 'sql',
};

/** The display name for a fence's language, or `null` for an unlabelled fence. */
export function languageLabel(lang: string | null): string | null {
  if (!lang) return null;
  const NAMES: Record<string, string> = {
    js: 'JavaScript', jsx: 'JSX', mjs: 'JavaScript', cjs: 'JavaScript',
    ts: 'TypeScript', tsx: 'TSX', py: 'Python', rb: 'Ruby', rs: 'Rust', sh: 'Shell',
    zsh: 'Zsh', bash: 'Bash', cpp: 'C++', 'c++': 'C++', cs: 'C#', 'c#': 'C#',
    kt: 'Kotlin', objc: 'Objective-C', yml: 'YAML', md: 'Markdown', html: 'HTML',
    css: 'CSS', scss: 'SCSS', sql: 'SQL', json: 'JSON', jsonc: 'JSONC', php: 'PHP',
    graphql: 'GraphQL', diff: 'Diff', toml: 'TOML', xml: 'XML', svg: 'SVG', c: 'C',
    go: 'Go', java: 'Java', swift: 'Swift', dart: 'Dart', lua: 'Lua', perl: 'Perl',
    r: 'R', scala: 'Scala', vim: 'Vim', ini: 'INI', make: 'Make', dockerfile: 'Dockerfile',
  };
  const key = lang.toLowerCase();
  // Capitalised as a fallback, so an unmapped `elixir` still reads as a name.
  return NAMES[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

/*
 * The languages the "Run" affordance is offered for.
 *
 * Not the same question as "can this be highlighted": a fence holding captured
 * output, a data file, a diagram or a diff colours perfectly well and there is
 * nothing there to run. Offering the control on those reads as a promise the block
 * cannot keep, so the set is written out rather than derived from `ALIASES` --
 * `console` in particular aliases to the shell spec because a transcript contains
 * shell syntax, but the transcript itself is output, not a script.
 *
 * It is also not "which languages exist". This list must stay in step with
 * `BY_LANG` in server/src/sandbox/languages.ts, which is the set the execution
 * sandbox has a runtime for. Ruby, Go, Rust, Swift and the rest colour here because
 * they colour like something this lexer knows, but the sandbox has no compiler for
 * them, and a Run button that answers `go: command not found` is worse than no Run
 * button. A language joins this list when the toolchain snapshot can run it.
 */
const RUNNABLE = new Set([
  // Deno, which is the sandbox's own runtime and needs nothing installed.
  'js', 'jsx', 'javascript', 'mjs', 'cjs', 'node', 'ts', 'tsx', 'typescript',
  // The three toolchains the snapshot adds, plus the shell that is always there.
  'py', 'python', 'python3',
  'c', 'cpp', 'c++', 'cc', 'cxx', 'java',
  'sh', 'bash', 'zsh', 'shell',
]);

/**
 * Whether a fence is source that could plausibly be run.
 *
 * `null` -- an unlabelled fence -- is false on purpose. A model that means code
 * nearly always names the language, so an unlabelled fence is far more often a
 * block of output, a tree of filenames or a scrap of prose than it is a program.
 */
export function isRunnable(lang: string | null): boolean {
  if (!lang) return false;
  return RUNNABLE.has(lang.toLowerCase());
}

const specFor = (lang: string | null): Spec =>
  SPECS[ALIASES[(lang ?? '').toLowerCase()] ?? 'text'];

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[A-Za-z0-9_$]/;
const DIGIT = /[0-9]/;
const OPERATOR = /[+\-*/%=<>!&|^~?]/;
const PUNCT = /[()[\]{},;:.]/;

/** True when the closer at `at` is escaped by an odd run of backslashes. */
function escaped(src: string, at: number): boolean {
  let slashes = 0;
  for (let i = at - 1; i >= 0 && src[i] === '\\'; i--) slashes += 1;
  return slashes % 2 === 1;
}

/**
 * Splits `source` into coloured runs.
 *
 * Returned tokens cover the input exactly and in order, so joining their text
 * reproduces it -- a highlighter that drops a character would silently corrupt
 * the code it is meant to be displaying. Adjacent runs of one kind are merged,
 * which matters: every token becomes a nested `Text`, and a block of code has
 * thousands of characters but only dozens of colour changes.
 */
export function tokenize(source: string, lang: string | null): Token[] {
  const spec = specFor(lang);
  const out: Token[] = [];
  let i = 0;

  const push = (text: string, kind: TokenKind) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ text, kind });
  };

  /** The last identifier seen, for `def foo` / `class Foo` definitions. */
  let prevWord = '';
  /** The last non-space character, so `.foo` reads as a property, not a call. */
  let prevChar = '';

  while (i < source.length) {
    const char = source[i];

    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      push(char, 'plain');
      i += 1;
      continue;
    }

    const rest = source.slice(i);

    const line = spec.lineComment.find((marker) => rest.startsWith(marker));
    if (line) {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? source.length : end;
      push(source.slice(i, stop), 'comment');
      i = stop;
      continue;
    }

    const block = spec.blockComment.find(([open]) => rest.startsWith(open));
    if (block) {
      const close = source.indexOf(block[1], i + block[0].length);
      // Unterminated: mid-stream the closer simply has not arrived yet.
      const stop = close === -1 ? source.length : close + block[1].length;
      push(source.slice(i, stop), 'comment');
      i = stop;
      continue;
    }

    const string = spec.strings.find((rule) => rest.startsWith(rule.open));
    if (string) {
      let j = i + string.open.length;
      while (j < source.length) {
        if (!string.multiline && source[j] === '\n') break;
        if (source.startsWith(string.close, j) && !(string.escape && escaped(source, j))) {
          j += string.close.length;
          break;
        }
        j += 1;
      }
      push(source.slice(i, Math.min(j, source.length)), 'string');
      i = Math.min(j, source.length);
      prevChar = '"';
      continue;
    }

    if (DIGIT.test(char) || (char === '.' && DIGIT.test(source[i + 1] ?? ''))) {
      let j = i;
      // One sweep for every numeric form: 0x1F, 1_000, 6.02e23, 100n, 3.5f.
      while (j < source.length && /[0-9a-fA-FxXoObBn._]/.test(source[j])) j += 1;
      if ((source[j] === '+' || source[j] === '-') && /[eE]/.test(source[j - 1] ?? '')) {
        j += 1;
        while (j < source.length && DIGIT.test(source[j])) j += 1;
      }
      push(source.slice(i, j), 'number');
      i = j;
      prevChar = '0';
      continue;
    }

    if (spec.meta && char === spec.meta && IDENT_START.test(source[i + 1] ?? '')) {
      let j = i + 1;
      while (j < source.length && IDENT_PART.test(source[j])) j += 1;
      push(source.slice(i, j), 'meta');
      i = j;
      prevChar = 'a';
      continue;
    }

    if (IDENT_START.test(char)) {
      let j = i;
      while (j < source.length && IDENT_PART.test(source[j])) j += 1;
      const word = source.slice(i, j);

      // What follows decides a bare identifier: a paren makes it a call.
      let k = j;
      while (k < source.length && (source[k] === ' ' || source[k] === '\t')) k += 1;
      const called = source[k] === '(';

      let kind: TokenKind = 'plain';
      if (spec.keywords.has(word)) kind = 'keyword';
      else if (spec.defines.has(prevWord)) kind = 'func';
      else if (prevChar === '.') kind = called ? 'func' : 'plain';
      else if (spec.builtins.has(word)) kind = 'builtin';
      else if (called) kind = 'func';

      push(word, kind);
      i = j;
      prevWord = word;
      prevChar = 'a';
      continue;
    }

    if (OPERATOR.test(char)) {
      let j = i;
      while (j < source.length && OPERATOR.test(source[j])) j += 1;
      push(source.slice(i, j), 'operator');
      prevChar = source[j - 1];
      i = j;
      // An operator ends any definition run: `def` then `=` is not a name.
      prevWord = '';
      continue;
    }

    if (PUNCT.test(char)) {
      push(char, 'punct');
      // `.` is kept, since it is what marks the next word as a property.
      prevChar = char;
      if (char !== '.') prevWord = '';
      i += 1;
      continue;
    }

    push(char, 'plain');
    prevChar = char;
    i += 1;
  }

  return out;
}
