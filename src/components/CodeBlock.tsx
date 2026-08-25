import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { MermaidView, useDiagram } from './MermaidView';
import { useTheme } from '../theme/ThemeProvider';
import { useChatStore } from '../store/ChatStore';
import { darkSyntax, isRunnable, languageLabel, lightSyntax, tokenize } from '../lib/highlight';
import { looksLikeMermaid } from '../lib/mermaid';
import { ApiError, runCode, type RunResult } from '../lib/api';
import { palette, type } from '../theme/tokens';

/** How long the copy button stays on its tick before returning to the glyph. */
const COPIED_MS = 1400;

const HEADER_GLYPH = 14;
const RUN_GLYPH = 9;
const HIT = 8;

/** A bare icon control in the header strip. */
function HeaderButton({
  onPress,
  label,
  children,
}: {
  onPress: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={HIT}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {children}
    </Pressable>
  );
}

/** Copy, flipping to a tick for a moment so the press has an answer. */
function CopyButton({ code }: { code: string }) {
  const { colors } = useTheme();
  const { hapticsEnabled } = useChatStore();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The tick is on a timer, so a block scrolled off mid-flash must not fire into
  // an unmounted component.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = useCallback(async () => {
    if (hapticsEnabled && Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    await Clipboard.setStringAsync(code).catch(() => {});
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  }, [code, hapticsEnabled]);

  return (
    <HeaderButton onPress={copy} label={copied ? 'Copied' : 'Copy code'}>
      <Feather
        name={copied ? 'check' : 'copy'}
        size={HEADER_GLYPH}
        color={copied ? colors.labelPrimary : colors.labelSecondary}
      />
    </HeaderButton>
  );
}

/**
 * The "Run" pill, which executes the block in a sandbox on the server.
 *
 * Three states in one control, because they are three answers to the same press.
 * Idle offers the run; running is the same pill with a spinner where the glyph was,
 * and pressing it again cancels rather than queuing a second run; once there is
 * output it says "Run" again, since a re-run is the obvious next thing to want.
 */
function RunPill({
  running,
  onPress,
}: {
  running: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      hitSlop={HIT}
      style={({ pressed }) => [
        styles.run,
        { borderColor: colors.codeBorder, opacity: pressed ? 0.6 : 1 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={running ? 'Stop running' : 'Run code'}
      accessibilityState={{ busy: running }}
    >
      {/*
        * Both glyphs sit in a box the size of the play triangle, so the pill keeps
        * its width when one replaces the other -- a control that resizes mid-press
        * moves out from under the finger still on it. `ActivityIndicator` has no
        * size below "small" (20pt), so it is scaled down and taken out of the flow
        * to fit; without `absolute` its own 20pt would set the box's width.
        */}
      <View style={styles.runGlyph}>
        {running ? (
          <ActivityIndicator
            size="small"
            color={colors.labelSecondary}
            style={styles.runSpinner}
          />
        ) : (
          <Feather name="play" size={RUN_GLYPH} color={colors.labelSecondary} />
        )}
      </View>
      <Text style={[type.chatCodeAction, { color: colors.labelSecondary }]}>
        {running ? 'Stop' : 'Run'}
      </Text>
    </Pressable>
  );
}

/** What the output pane is showing, if anything. */
type RunState =
  | { phase: 'idle' }
  | { phase: 'running' }
  | { phase: 'done'; result: RunResult }
  /** A request that never reached a program: no session, no runner, no network. */
  | { phase: 'failed'; message: string };

/** Empty output still deserves a line, or a successful silent run looks broken. */
const SILENT = '(no output)';

/**
 * A one-line status above the output: how it ended, and how long it took.
 *
 * The exit code is only worth showing when it is not zero. On a clean run it tells
 * the reader nothing they cannot see from the output itself, and a row of metadata
 * over three lines of print is heavier than the thing it describes.
 */
function RunStatus({ result }: { result: RunResult }) {
  const { colors } = useTheme();
  const failed = result.exitCode !== 0;
  const seconds = (result.durationMs / 1000).toFixed(1);

  const detail = result.timedOut
    ? `Timed out after ${seconds}s`
    : failed
      ? `Exit ${result.exitCode} · ${seconds}s`
      : `${seconds}s`;

  return (
    <View style={styles.status}>
      <Feather
        name={result.timedOut ? 'clock' : failed ? 'alert-circle' : 'check'}
        size={RUN_GLYPH + 2}
        color={failed ? palette.danger : colors.labelSecondary}
      />
      <Text
        style={[type.chatCodeAction, { color: failed ? palette.danger : colors.labelSecondary }]}
        numberOfLines={1}
      >
        {detail}
      </Text>
      {result.truncated ? (
        <Text style={[type.chatCodeAction, { color: colors.labelTertiary }]} numberOfLines={1}>
          · output trimmed
        </Text>
      ) : null}
    </View>
  );
}

/**
 * The output pane: whatever the program printed, under the source it came from.
 *
 * stdout and stderr are shown in one run rather than as two labelled sections. That
 * is how a terminal shows them, and it is what makes an exception's traceback read
 * as following the output that preceded it. stderr is tinted only when the program
 * actually failed -- plenty of well-behaved programs log progress to stderr, and
 * colouring that red would report a successful run as a broken one.
 *
 * Not selectable-scrollable sideways like the source: output wraps. A long line of
 * print carries no indentation to protect, and a pane that pans while the code above
 * it pans separately reads as two unrelated things.
 */
function Output({ state }: { state: Exclude<RunState, { phase: 'idle' }> }) {
  const { colors } = useTheme();

  if (state.phase === 'running') {
    return (
      <View style={[styles.output, { borderTopColor: colors.codeBorder }]}>
        <View style={styles.status}>
          <ActivityIndicator size="small" color={colors.labelSecondary} />
          <Text style={[type.chatCodeAction, { color: colors.labelSecondary }]}>Running…</Text>
        </View>
      </View>
    );
  }

  if (state.phase === 'failed') {
    return (
      <View style={[styles.output, { borderTopColor: colors.codeBorder }]}>
        <View style={styles.status}>
          <Feather name="alert-circle" size={RUN_GLYPH + 2} color={palette.danger} />
          <Text style={[type.chatCodeAction, { color: palette.danger }]}>Could not run</Text>
        </View>
        <Text style={[type.chatCode, styles.outputText, { color: colors.labelSecondary }]} selectable>
          {state.message}
        </Text>
      </View>
    );
  }

  const { result } = state;
  const failed = result.exitCode !== 0;
  const empty = !result.stdout && !result.stderr;

  return (
    <View style={[styles.output, { borderTopColor: colors.codeBorder }]}>
      <RunStatus result={result} />
      {empty ? (
        <Text style={[type.chatCode, styles.outputText, { color: colors.labelTertiary }]}>
          {SILENT}
        </Text>
      ) : (
        <Text style={[type.chatCode, styles.outputText]} selectable>
          {result.stdout ? (
            <Text style={{ color: colors.labelPrimary }}>{result.stdout}</Text>
          ) : null}
          {result.stderr ? (
            <Text style={{ color: failed ? palette.danger : colors.labelSecondary }}>
              {result.stderr}
            </Text>
          ) : null}
        </Text>
      )}
    </View>
  );
}

/**
 * A diagram fence's three controls: show the Mermaid source, show the rendered
 * preview, and open it full screen.
 *
 * The first two are one toggle drawn as two controls, which is what the design
 * asks for -- whichever view is showing, the other one's control is the way back.
 * The active one is at full strength and the other a step back, so the pair reads as
 * a state rather than as two buttons that might do the same thing.
 */
function DiagramActions({
  showingSource,
  onShowSource,
  onShowPreview,
  onExpand,
}: {
  showingSource: boolean;
  onShowSource: () => void;
  onShowPreview: () => void;
  onExpand: () => void;
}) {
  const { colors } = useTheme();
  const active = colors.labelPrimary;
  const idle = colors.labelSecondary;

  return (
    <View style={styles.actions}>
      <HeaderButton onPress={onShowSource} label="Show Mermaid source">
        <Feather name="code" size={HEADER_GLYPH} color={showingSource ? active : idle} />
      </HeaderButton>

      <HeaderButton onPress={onShowPreview} label="Show diagram preview">
        <Feather name="play" size={HEADER_GLYPH} color={showingSource ? idle : active} />
      </HeaderButton>

      <HeaderButton onPress={onExpand} label="Open diagram full screen">
        <Feather name="maximize-2" size={HEADER_GLYPH} color={idle} />
      </HeaderButton>
    </View>
  );
}

/**
 * The code itself, coloured.
 *
 * One `Text` with a nested span per token rather than a `Text` per line: React
 * Native flattens nested text into a single native string, so the whole body is
 * one measured node and the lines cannot drift out of alignment with each other.
 * `selectable` is on the parent, which is what makes the selection run across
 * tokens instead of stopping at each colour change.
 *
 * Not memoised on the token list. A code fence is re-tokenised on each streamed
 * write, but the scan is a single linear pass over a few hundred characters --
 * cheaper than the comparison a memo would have to do, since the string is new
 * every time anyway.
 */
function Highlighted({ code, lang }: { code: string; lang: string | null }) {
  const { scheme } = useTheme();
  const palette = scheme === 'dark' ? darkSyntax : lightSyntax;
  const tokens = tokenize(code, lang);

  return (
    <Text style={type.chatCode} selectable>
      {tokens.map((token, index) => (
        // Index keys are safe here: the list is rebuilt whole on every render and
        // nothing in it holds state or animates.
        <Text key={index} style={{ color: palette[token.kind] }}>
          {token.text}
        </Text>
      ))}
    </Text>
  );
}

/** The source, panning sideways rather than wrapping. */
function Source({ code, lang }: { code: string; lang: string | null }) {
  return (
    /*
     * A wrapped line of code silently changes its own indentation, which is the one
     * thing in a code block that carries meaning -- so a long line runs off the
     * edge, as it does in an editor.
     */
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      directionalLockEnabled
      contentContainerStyle={styles.body}
    >
      <Highlighted code={code} lang={lang} />
    </ScrollView>
  );
}

/**
 * A diagram filling the screen, for a chart too wide or too tall to read inline.
 *
 * The same `MermaidView`, so there is one drawing and one place a fix to it lands.
 * `Modal` rather than a route: it is a look at the block it was opened from, not a
 * place in the app the back gesture should be able to land on from elsewhere.
 */
function FullScreen({
  diagram,
  label,
  onClose,
}: {
  diagram: Parameters<typeof MermaidView>[0]['diagram'];
  label: string | null;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.full, { backgroundColor: colors.bgPrimary, paddingTop: insets.top }]}>
        <View style={styles.fullBar}>
          <Text style={[type.chatCodeLabel, { color: colors.labelPrimary }]} numberOfLines={1}>
            {label ?? 'Diagram'}
          </Text>
          <HeaderButton onPress={onClose} label="Close diagram">
            <Feather name="x" size={20} color={colors.labelPrimary} />
          </HeaderButton>
        </View>
        {/* Vertical here, horizontal inside `MermaidView`: full screen is where a
            tall chart is read, and a chart taller than the screen would otherwise
            have nowhere to go. */}
        <ScrollView
          contentContainerStyle={[styles.fullBody, { paddingBottom: insets.bottom + 16 }]}
          showsVerticalScrollIndicator={false}
        >
          <MermaidView diagram={diagram} />
        </ScrollView>
      </View>
    </Modal>
  );
}

/**
 * Drives one block's Run button: the request, its state, and cancelling it.
 *
 * The abort controller is the whole reason this is a hook rather than a handler.
 * A run holds a sandbox open, and sandboxes are a small fixed pool shared by every
 * user of the server -- so a block scrolled off screen mid-run, or a second press,
 * has to actually release it rather than leave it running until its own deadline.
 */
function useRun(code: string, lang: string | null) {
  const { authToken, hapticsEnabled } = useChatStore();
  const [state, setState] = useState<RunState>({ phase: 'idle' });
  const inFlight = useRef<AbortController | null>(null);

  // A block can leave the transcript mid-run -- scrolled far enough away, or its
  // message regenerated -- and the request should go with it.
  useEffect(() => () => inFlight.current?.abort(), []);

  /*
   * Output belongs to the code that produced it. A fence still streaming rewrites
   * `code` on every chunk, and a regenerated reply replaces it wholesale; keeping
   * the old output under either would attribute one program's print to another.
   *
   * Compared against a ref rather than keyed on `[code]`, so the reset happens only
   * on a real change and not once more on mount.
   */
  const ran = useRef(code);
  useEffect(() => {
    if (ran.current === code) return;
    ran.current = code;
    inFlight.current?.abort();
    inFlight.current = null;
    setState({ phase: 'idle' });
  }, [code]);

  const run = useCallback(async () => {
    // A second press while one is in flight cancels rather than queueing: the pill
    // says "Stop" at that point, which is the promise being kept.
    if (inFlight.current) {
      inFlight.current.abort();
      inFlight.current = null;
      setState({ phase: 'idle' });
      return;
    }
    if (!lang) return;

    if (hapticsEnabled && Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }

    const controller = new AbortController();
    inFlight.current = controller;
    setState({ phase: 'running' });

    try {
      const result = await runCode(authToken, { code, lang, signal: controller.signal });
      if (controller.signal.aborted) return;
      setState({ phase: 'done', result });
    } catch (error) {
      if (controller.signal.aborted) return;
      /*
       * `ApiError` carries the server's own sentence -- "not configured", "runner
       * busy", "session expired" -- and those are the useful ones. Anything else is
       * the transport, which from a phone is nearly always the dev server not being
       * reachable, so it says that rather than echoing a stack.
       */
      setState({
        phase: 'failed',
        message:
          error instanceof ApiError
            ? error.message
            : 'Could not reach the server. Check that it is running and that EXPO_PUBLIC_API_URL points at it.',
      });
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
    }
  }, [authToken, code, hapticsEnabled, lang]);

  return { state, run };
}

/**
 * A fenced code block: a header strip naming the language and carrying its
 * controls, over the highlighted source.
 *
 * A flowchart draws as a diagram instead, keeping the same chrome, and swaps the
 * controls for the diagram's own three: source, preview, full screen. The label is
 * not trusted to say which fence that is -- a model asked for a flowchart writes the
 * source into a bare ``` fence about as often as it labels it -- so the body is
 * sniffed as well. When the diagram cannot be drawn (an unsupported diagram type, or
 * a flowchart still arriving) it falls through to the code path, which is the one
 * thing that is always truthful about what the model wrote.
 */
export function CodeBlock({ code, lang }: { code: string; lang: string | null }) {
  const { colors } = useTheme();
  const label = languageLabel(lang);
  const isMermaid = lang?.toLowerCase() === 'mermaid' || looksLikeMermaid(code);
  // Hooks cannot be conditional, so the parse is gated by its own argument.
  const diagram = useDiagram(isMermaid ? code : null);
  const { state: runState, run } = useRun(code, lang);

  const [showingSource, setShowingSource] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const drawing = diagram !== null && !showingSource;
  // An unlabelled fence that turned out to be a flowchart is named anyway: the
  // header would otherwise be a lone glyph over a diagram.
  const title = label ?? (diagram ? 'Mermaid' : null);

  return (
    <View style={[styles.block, { backgroundColor: colors.codeSurface }]}>
      <View style={[styles.header, { backgroundColor: colors.codeHeader }]}>
        <View style={styles.language}>
          <Feather name="code" size={HEADER_GLYPH} color={colors.labelSecondary} />
          {title ? (
            <Text style={[type.chatCodeLabel, { color: colors.labelPrimary }]} numberOfLines={1}>
              {title}
            </Text>
          ) : null}
        </View>

        {diagram ? (
          <DiagramActions
            showingSource={showingSource}
            onShowSource={() => setShowingSource(true)}
            onShowPreview={() => setShowingSource(false)}
            onExpand={() => setExpanded(true)}
          />
        ) : (
          <View style={styles.actions}>
            <CopyButton code={code} />
            {isRunnable(lang) ? (
              <RunPill running={runState.phase === 'running'} onPress={run} />
            ) : null}
          </View>
        )}
      </View>

      {drawing ? (
        <View style={styles.diagram}>
          <MermaidView diagram={diagram} />
        </View>
      ) : (
        <Source code={code} lang={lang} />
      )}

      {/* Under the source, inside the same rounded block: the output is this
          block's, and a separate card would break that. */}
      {runState.phase === 'idle' ? null : <Output state={runState} />}

      {expanded && diagram ? (
        <FullScreen diagram={diagram} label={title} onClose={() => setExpanded(false)} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // `hidden` is what keeps the header strip's own corners inside the radius.
  block: { borderRadius: 12, overflow: 'hidden' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 12,
    paddingRight: 10,
    paddingVertical: 7,
  },
  // `flexShrink` so a long language name gives way to the controls rather than
  // pushing them off the edge.
  language: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  /*
   * The Run pill. A radius past half the height rounds to a capsule whatever the
   * text inside it measures, which is what keeps the ends true without pinning a
   * height the label then has to fit.
   */
  run: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  /*
   * A fixed box for whichever of the two glyphs is showing, so swapping the play
   * triangle for a spinner does not change the pill's width. The spinner is the
   * larger of the two, and `small` measures 20pt on both platforms.
   */
  runGlyph: {
    width: RUN_GLYPH + 2,
    height: RUN_GLYPH + 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  runSpinner: { position: 'absolute', transform: [{ scale: (RUN_GLYPH + 3) / 20 }] },
  /*
   * The output pane. Same horizontal padding as `body`, so print lines up with the
   * source above it, and a hairline above rather than a gap: they are one block.
   */
  output: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 10,
    gap: 6,
  },
  status: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  // Output wraps rather than panning, so it needs the tighter leading of prose --
  // `chatCode`'s 22pt over 15pt is set for code that never wraps.
  outputText: { lineHeight: 20 },
  // Padding on the content, not the scroll view: on the view it would clip away
  // at the first pan.
  body: { paddingHorizontal: 12, paddingVertical: 10 },
  diagram: { paddingVertical: 6 },
  full: { flex: 1 },
  fullBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    height: 44,
  },
  // Grows to fill the screen so a chart shorter than it stays centred.
  fullBody: { flexGrow: 1, justifyContent: 'center' },
});
