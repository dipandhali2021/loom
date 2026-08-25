import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { MermaidView, useDiagram } from './MermaidView';
import { useTheme } from '../theme/ThemeProvider';
import { useChatStore } from '../store/ChatStore';
import { darkSyntax, isRunnable, languageLabel, lightSyntax, tokenize } from '../lib/highlight';
import { looksLikeMermaid } from '../lib/mermaid';
import { type } from '../theme/tokens';

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
 * The "Run" pill.
 *
 * No handler by design -- the ask was the affordance, not an execution backend --
 * so it is a plain `View` rather than a disabled `Pressable`. A control that dims
 * under a finger and then does nothing reads as broken; one that never responds to
 * touch reads as a label, which is what this is until there is something behind it.
 * Hidden from the accessibility tree for the same reason: announcing a button that
 * cannot be activated is worse than silence.
 */
function RunPill() {
  const { colors } = useTheme();
  return (
    <View
      style={[styles.run, { borderColor: colors.codeBorder }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Feather name="play" size={RUN_GLYPH} color={colors.labelSecondary} />
      <Text style={[type.chatCodeAction, { color: colors.labelSecondary }]}>Run</Text>
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
            {isRunnable(lang) ? <RunPill /> : null}
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
