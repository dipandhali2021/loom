import React, { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Icon } from './Icon';
import { AttachmentChips } from './AttachmentChips';
import { AppText } from './AppText';
import { ProviderMark } from './ProviderMark';
import type { PendingAttachment } from '../store/types';
import { useTheme } from '../theme/ThemeProvider';
import { useChatStore } from '../store/ChatStore';
import { layout, palette, type as typeTokens } from '../theme/tokens';

type Props = {
  onSubmit: (text: string) => void;
  onOpenVoice: () => void;
  onStop?: () => void;
  /** Streaming replaces the send affordance with a stop control. */
  isStreaming?: boolean;
  /** Controlled draft text, so a tapped prompt chip can pre-fill the field. */
  value: string;
  onChangeText: (next: string) => void;
  /**
   * Naming the mode in the field itself, the way the app does: "Temporary chat"
   * while one is open, "Ask anything" otherwise. It is the only label on screen once
   * the first turn has scrolled the explanation away, so it is what a user coming
   * back to the app reads to know nothing here is being kept.
   */
  placeholder?: string;
  /** The attachment panel is open, which is what turns the "+" into an "x". */
  sheetOpen?: boolean;
  /** Tapping the leading control. The screen decides which of the two it means. */
  onToggleSheet?: () => void;
  /**
   * The field, so the screen can put the keyboard back when the panel closes.
   * Held there rather than here because the panel is the screen's child: it is
   * laid out below this bar, in the room the keyboard vacated.
   */
  inputRef?: React.RefObject<TextInput | null>;
  /** Tapping into the field. Raising the keyboard is what closes the panel. */
  onFocusField?: () => void;
  /** Web search is armed for the next turn. Toggled from the control row below. */
  webSearch?: boolean;
  /** Arms or disarms it. The control row's globe is the only switch there is now. */
  onToggleWebSearch?: (on: boolean) => void;
  /**
   * The model this turn will go to, as the picker labels it.
   *
   * Null only when there is genuinely no model yet -- a fresh install whose catalog
   * has not arrived. A remembered model is named immediately, from its id, so the
   * chip does not read as a placeholder for the first second of every launch.
   */
  modelLabel?: string | null;
  /** The model's id, for its provider mark. */
  modelId?: string | null;
  /**
   * The catalog request has settled. Only consulted when there is no model to name:
   * it separates "still asking" from "nothing is configured upstream".
   */
  modelsLoaded?: boolean;
  /** Opens the model sheet. */
  onPressModel?: () => void;
  /** Files picked for this turn, shown as tiles above the pill. */
  attachments?: PendingAttachment[];
  onRemoveAttachment?: (id: string) => void;
  /**
   * Dictation, driven by the mic glyph inside the pill -- not the trailing button,
   * which is voice mode and a screen of its own. The screen owns the recorder so
   * this stays a presentational bar.
   */
  dictation?: {
    phase: 'idle' | 'recording' | 'transcribing';
    durationMillis: number;
    error: string | null;
    toggle: () => void;
    cancel: () => void;
    clearError: () => void;
  };
};

/**
 * A quarter turn plus a half, so the glyph visibly spins rather than snapping.
 * A plus has four-fold symmetry, so 45deg would already be an "x" -- 135 is the
 * same destination reached the long way round.
 */
const CROSS_ROTATION = 135;

/** m:ss, so a long dictation still reads at a glance. */
function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
const ROTATE_MS = 240;
const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1);

/**
 * The composer: a flat pill holding "+", the "Ask anything" field, a mic, and a
 * round trailing button that cycles submit -> stop -> voice depending on state.
 *
 * Two layouts, not one. At rest it is the single row above -- unchanged, and short.
 * Focused, the text moves to the top and a control row appears beneath it carrying
 * the same "+" and mic plus the two things that belong to the message rather than to
 * the screen: whether it searches the web, and which model answers it.
 *
 * The model lives here rather than in the nav bar because it is a property of the
 * turn being written. The cost is that it is invisible until the field is tapped,
 * which is the right trade: a bar that names a model you are not currently sending
 * to is decoration.
 */
export function Composer({
  onSubmit,
  onOpenVoice,
  onStop,
  isStreaming = false,
  value: text,
  onChangeText: setText,
  placeholder = 'Ask anything',
  sheetOpen = false,
  onToggleSheet,
  inputRef,
  onFocusField,
  webSearch = false,
  onToggleWebSearch,
  modelLabel,
  modelId,
  modelsLoaded = false,
  onPressModel,
  attachments = [],
  onRemoveAttachment,
  dictation,
}: Props) {
  const { colors } = useTheme();
  const { hapticsEnabled } = useChatStore();

  /*
   * Expanded because the field has focus, or because there is something to send.
   *
   * The second half is what stops a blur from hiding the model and the search state
   * out from under a half-written message: dismissing the keyboard over a draft
   * leaves the controls that describe that draft on screen. It also means the panel
   * being open (which takes focus) does not collapse the bar.
   */
  const [focused, setFocused] = useState(false);

  const hasText = text.trim().length > 0;
  /*
   * A file on its own is a sendable turn -- "what is this" is usually the photo --
   * so the trailing button becomes send once one is ready, the same way text does.
   * Only once it is ready: sending mid-upload would post a turn with nothing attached.
   */
  const hasAttachment = attachments.some((a) => a.status === 'ready');
  const canSend = hasText || hasAttachment;
  const recording = dictation?.phase === 'recording';
  const transcribing = dictation?.phase === 'transcribing';

  /*
   * Also expanded while the attachment panel is open or a dictation is running --
   * both are states of the message being composed, and collapsing under either would
   * pull the controls out from beneath what the user is doing.
   */
  const expanded = focused || canSend || sheetOpen || recording || transcribing;

  /*
   * Driven off the prop rather than off local state: the panel can also be closed
   * by swiping it down, and the glyph has to follow that too.
   */
  const cross = useSharedValue(sheetOpen ? 1 : 0);
  React.useEffect(() => {
    cross.value = withTiming(sheetOpen ? 1 : 0, { duration: ROTATE_MS, easing: EASE_OUT });
  }, [cross, sheetOpen]);

  const crossStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${cross.value * CROSS_ROTATION}deg` }],
  }));

  const tap = () => {
    if (hapticsEnabled && Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
  };

  const submit = () => {
    const value = text.trim();
    if (!value && !hasAttachment) return;
    tap();
    setText('');
    onSubmit(value);
  };

  /*
   * The controls shared by both layouts, built once here rather than written twice.
   *
   * They move between rows -- "+" and the mic sit inside the pill at rest and on the
   * control row when expanded -- and duplicating the JSX is how the two copies drift
   * apart on the next edit.
   */
  const plusButton = (
    <Pressable
      onPress={() => {
        tap();
        onToggleSheet?.();
      }}
      hitSlop={8}
      style={styles.glyph}
      accessibilityRole="button"
      accessibilityLabel={sheetOpen ? 'Close attachments' : 'Add attachment'}
      accessibilityState={{ expanded: sheetOpen }}
    >
      {/* One glyph turned, not two swapped: a plus rotated onto its diagonal
          *is* the cross, so there is nothing to cross-fade and nothing that can
          land half a pixel off its predecessor. */}
      <Animated.View style={crossStyle}>
        <Feather name="plus" size={22} color={colors.labelSecondary} />
      </Animated.View>
    </Pressable>
  );

  const micButton = (
    <Pressable
      onPress={() => {
        if (transcribing) return;
        tap();
        dictation?.toggle();
      }}
      onLongPress={() => {
        if (!recording) return;
        tap();
        dictation?.cancel();
      }}
      hitSlop={8}
      style={styles.glyph}
      disabled={transcribing}
      accessibilityRole="button"
      accessibilityLabel={recording ? 'Stop dictation' : transcribing ? 'Transcribing' : 'Dictate'}
      accessibilityHint={recording ? 'Press and hold to discard' : undefined}
    >
      {transcribing ? (
        <ActivityIndicator size="small" color={colors.labelSecondary} />
      ) : (
        <Feather
          name={recording ? 'square' : 'mic'}
          size={recording ? 16 : 20}
          // Red while it is live: it is the one control in the bar that is
          // recording the room, and it should not look like the others.
          color={recording ? palette.danger : colors.labelSecondary}
        />
      )}
    </Pressable>
  );

  // One button, three jobs — the kit draws all three as the same black circle.
  const action = isStreaming
    ? {
        label: 'Stop generating',
        onPress: onStop,
        glyph: <MaterialIcons name="stop" size={20} color={colors.sendGlyph} />,
      }
    : canSend
      ? {
          label: 'Send message',
          onPress: submit,
          glyph: <Feather name="arrow-up" size={20} color={colors.sendGlyph} />,
        }
      : {
          label: 'Voice conversation',
          onPress: onOpenVoice,
          glyph: <MaterialIcons name="graphic-eq" size={20} color={colors.sendGlyph} />,
        };

  return (
    <View style={styles.row}>
      <AttachmentChips attachments={attachments} onRemove={onRemoveAttachment ?? (() => {})} />

      {/*
       * The running timer, above the pill rather than inside it: the field keeps its
       * placeholder and its full width while recording, because dictation appends to
       * a draft that may already be half written.
       */}
      {recording ? (
        <View style={styles.status}>
          <View style={[styles.pulse, { backgroundColor: palette.danger }]} />
          <AppText variant="footnote" tone="secondary">
            {`Listening  ${formatDuration(dictation?.durationMillis ?? 0)}`}
          </AppText>
          <AppText variant="footnote" tone="tertiary">
            Tap to stop
          </AppText>
        </View>
      ) : null}

      {dictation?.error ? (
        <Pressable onPress={dictation.clearError} style={styles.status}>
          <AppText variant="footnote" tone="none" style={{ color: palette.danger }}>
            {dictation.error}
          </AppText>
        </Pressable>
      ) : null}

      <View
        style={[
          styles.pill,
          {
            backgroundColor: colors.composerFill,
            // A capsule stops reading as one at two rows tall: the curve starts
            // eating the corners of the control row. So the radius relaxes when the
            // bar grows, and the pill stays a true capsule while it is one line.
            borderRadius: expanded ? layout.composerExpandedRadius : layout.composerRadius,
          },
          expanded ? styles.pillExpanded : null,
        ]}
      >
        <View style={styles.textRow}>
          {/* At rest the "+" sits beside the field. Expanded it moves to the row
              below, where it lines up with the other controls. */}
          {expanded ? null : plusButton}

          <TextInput
            ref={inputRef}
            value={text}
            onChangeText={setText}
            onFocus={() => {
              setFocused(true);
              onFocusField?.();
            }}
            /*
             * Collapsing is left to `expanded`, which also weighs the draft: losing
             * focus over half a sentence keeps the row, because those controls
             * describe the message still sitting in the field.
             */
            onBlur={() => setFocused(false)}
            placeholder={placeholder}
            placeholderTextColor={colors.labelTertiary}
            style={[
              typeTokens.composer,
              styles.input,
              expanded ? styles.inputExpanded : null,
              { color: colors.labelPrimary },
            ]}
            multiline
            returnKeyType="default"
            accessibilityLabel={placeholder}
          />

          {expanded ? null : micButton}
          {expanded ? null : (
            <Pressable
              onPress={action.onPress}
              hitSlop={8}
              style={[styles.send, { backgroundColor: colors.sendButton }]}
              accessibilityRole="button"
              accessibilityLabel={action.label}
            >
              {action.glyph}
            </Pressable>
          )}
        </View>

        {/*
         * The control row. Everything that is a property of this message rather than
         * of the screen: what it may attach, whether it searches, and which model
         * answers it.
         */}
        {expanded ? (
          <View style={styles.controlRow}>
            {plusButton}

            {/*
             * The web-search switch itself, not an indicator of one set elsewhere.
             * It used to be a row inside the attachment panel with a read-only chip
             * here; two places for one switch, and the panel is two taps away from
             * the field the question is typed in. Filled while armed.
             */}
            <Pressable
              onPress={() => {
                tap();
                onToggleWebSearch?.(!webSearch);
              }}
              hitSlop={6}
              style={[
                styles.chip,
                webSearch ? { backgroundColor: colors.fillPrimary } : null,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Web search"
              accessibilityState={{ selected: webSearch }}
              accessibilityHint={
                webSearch ? 'Turns web search off' : 'Lets this turn search the web'
              }
            >
              <Icon
                name="globe-01"
                size={18}
                color={webSearch ? colors.labelPrimary : colors.labelSecondary}
              />
            </Pressable>

            {/* Takes the slack, so the model chip sits against the mic and the
                send button rather than floating in the middle. */}
            <View style={styles.spacer} />

            <Pressable
              onPress={() => {
                tap();
                onPressModel?.();
              }}
              hitSlop={6}
              style={({ pressed }) => [styles.model, { opacity: pressed ? 0.6 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel={
                modelLabel ? `Model: ${modelLabel}, change model` : 'Choose a model'
              }
            >
              {/* No mark until there is a model to draw one for -- a placeholder
                  circle beside a placeholder word would look like a failed fetch. */}
              {modelId ? (
                <ProviderMark modelId={modelId} label={modelLabel ?? modelId} size={18} />
              ) : null}
              <AppText
                variant="footnote"
                tone={modelLabel ? 'secondary' : 'tertiary'}
                numberOfLines={1}
                style={styles.modelLabel}
              >
                {/*
                 * Three states, and only the first is common. A remembered model is
                 * named from its id before the catalog arrives, so this falls through
                 * to a placeholder only on a fresh install -- where "Loading" is the
                 * truth until the request settles, and "Model" afterwards is the
                 * invitation to pick from a list that turned out to be empty.
                 */}
                {modelLabel ?? (modelsLoaded ? 'Model' : 'Loading')}
              </AppText>
              <Feather name="chevron-down" size={14} color={colors.labelTertiary} />
            </Pressable>

            {micButton}

            <Pressable
              onPress={action.onPress}
              hitSlop={8}
              style={[styles.send, { backgroundColor: colors.sendButton }]}
              accessibilityRole="button"
              accessibilityLabel={action.label}
            >
              {action.glyph}
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: layout.chatPadding },
  // One line above the pill, for the recording timer and for a failure worth reading.
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 4,
    paddingBottom: 6,
  },
  pulse: { width: 8, height: 8, borderRadius: 4 },
  /*
   * The pill is a column of rows now, not a row of controls: one row at rest, two
   * when focused. The horizontal insets stay on the pill so both rows share a left
   * and right edge; everything else about a row is the row's own business.
   */
  pill: {
    borderRadius: layout.composerRadius,
    // The glyph boxes centre their icons, so the pill's own inset is reduced by
    // that inset to keep the "+" 14pt from the pill's edge.
    paddingLeft: 8,
    paddingRight: 6,
    paddingVertical: layout.composerPaddingV,
  },
  /*
   * A little more air below once the control row exists, because that row's own
   * glyph boxes are shorter than the field and the pill would otherwise sit tight
   * under them.
   */
  pillExpanded: { paddingBottom: layout.composerPaddingV + 2 },
  textRow: {
    flexDirection: 'row',
    // Centred, not bottom-aligned: the field's minHeight is taller than the
    // sibling glyph boxes, so flex-end pushed the placeholder above the "+".
    alignItems: 'center',
    // 6pt of gap plus the glyph boxes' own inset reads as the kit's 12pt.
    gap: 6,
  },
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  // Pushes the model chip and the two trailing controls to the right edge.
  spacer: { flex: 1 },
  /*
   * The model chip: mark, full label, chevron.
   *
   * The label is not shortened. A user who has enabled four combos from one
   * provider needs the part that differs, and that part is at the end -- so the
   * chip shrinks (`flexShrink`) and truncates its own text rather than being
   * abbreviated up front into something ambiguous.
   */
  model: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flexShrink: 1,
    paddingHorizontal: 4,
    height: layout.sendButtonSize,
  },
  modelLabel: { flexShrink: 1 },
  input: {
    flex: 1,
    // A multiline field grows with its content; min/max bound it to one line and
    // roughly four, which is the range the kit draws.
    minHeight: layout.composerFieldHeight,
    maxHeight: layout.composerMaxHeight,
    // Android draws a multiline TextInput with its own vertical padding; zeroing
    // it and centring the text is what keeps the baseline on the icons' axis.
    paddingTop: 0,
    paddingBottom: 0,
    textAlignVertical: 'center',
    // iOS ignores textAlignVertical, so a one-line field is centred by splitting
    // the difference between the field height and the line box.
    ...Platform.select({
      ios: {
        paddingTop: (layout.composerFieldHeight - typeTokens.composer.lineHeight) / 2,
        paddingBottom: (layout.composerFieldHeight - typeTokens.composer.lineHeight) / 2,
      },
      default: {},
    }),
  },
  /*
   * Expanded, the text starts at the top and grows downwards towards the control
   * row, instead of staying vertically centred in a box that is now two rows tall.
   * The centring insets above are undone for the same reason -- a first line that
   * begins 8pt down from the pill's edge looks like a mistake next to a caret.
   */
  inputExpanded: {
    textAlignVertical: 'top',
    paddingTop: 0,
    paddingBottom: 0,
  },
  // Fixed boxes for the bare glyphs, as tall as a one-line field, so every child
  // shares one centre line no matter how tall the field grows.
  glyph: {
    width: layout.sendButtonSize,
    height: layout.composerFieldHeight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /*
   * The armed-search chip: the globe alone, in a circle.
   *
   * No label. "Search" beside the glyph spent a third of the field's width saying
   * what the glyph already said, and on a narrow phone that is the difference
   * between a placeholder that fits and one that truncates. Kept smaller than the
   * sibling glyph boxes so it reads as a state the composer is in rather than as
   * another button in the row.
   */
  chip: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  send: {
    width: layout.sendButtonSize,
    height: layout.sendButtonSize,
    borderRadius: layout.sendButtonSize / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
