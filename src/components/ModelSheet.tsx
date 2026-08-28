import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from './AppText';
import { Icon } from './Icon';
import { ProviderMark } from './ProviderMark';
import { useTheme } from '../theme/ThemeProvider';
import { iconSlug } from '../lib/modelIcon';
import { layout, type as typeTokens } from '../theme/tokens';
import type { ApiModel } from '../lib/api';

/**
 * The model list, opened from the composer's control row.
 *
 * Built on SourcesSheet rather than on the old dropdown card: the list is now
 * however long the proxy says it is, and it is opened from the bottom of the screen
 * with a keyboard usually up. A 262pt card hanging off the nav bar could be neither.
 *
 * So the same treatment the sources list gets -- a Modal presented without
 * animation, slide and scrim driven off one shared value so a downward drag can
 * scrub it away, capped at a share of the screen with the rows scrolling inside.
 *
 * Unlike the sources list it has a search field, and that is why it measures the
 * keyboard: see `keyboard` below. A Modal is its own window and is not resized when
 * the keyboard opens, so without measuring, the rows a query narrowed down to sit
 * behind the keys that were used to type it.
 */

type Props = {
  visible: boolean;
  onClose: () => void;
  models: ApiModel[];
  /** Null before the catalog has arrived, which is when the empty state shows. */
  selected: string | null;
  onSelect: (id: string) => void;
  /** The catalog request has settled. Separates "none configured" from "loading". */
  loaded: boolean;
  /**
   * Re-read the catalog past the server's cache. Resolves false if it failed, which
   * the button reports rather than swallowing; never rejects.
   */
  onRefresh: () => Promise<boolean>;
};

const OPEN_DURATION = 300;
const CLOSE_DURATION = 220;
const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1);
const EASE_IN = Easing.bezier(0.4, 0, 1, 1);

/** Share of the screen the sheet may take, however many models there are. */
const MAX_HEIGHT_RATIO = 0.72;

/**
 * A keyboard frame smaller than this is not a keyboard worth making room for.
 *
 * A hardware keyboard reports a few points of accessory bar; same guard the chat
 * screen applies to the number it sizes the attachment panel from.
 */
const KEYBOARD_MIN_HEIGHT = 120;

/**
 * Air left above the sheet when the keyboard has taken most of the screen.
 *
 * Without it a long list plus a keyboard fills the window edge to edge and the sheet
 * stops reading as something laid over the chat.
 */
const TOP_GAP = 24;

/**
 * Floor under the card's content, for a short screen with a tall keyboard where the
 * arithmetic above would leave almost nothing. Overrunning the top gap is the better
 * failure: a sheet you can scroll beats a sheet with no room for a row in it.
 */
const MIN_CONTENT_HEIGHT = 180;

const CLOSE_FRACTION = 0.3;
const CLOSE_VELOCITY = 600;

/**
 * How many models it takes before searching and filtering earn their space.
 *
 * Below this the list is shorter than the chrome that would help you navigate it,
 * so a search field would be furniture -- and with one combo configured it would be
 * a search field over a single row.
 */
const TOOLS_THRESHOLD = 8;

/** "qwen" -> "Qwen", for a filter chip's label. */
const titleCase = (slug: string) => slug.charAt(0).toUpperCase() + slug.slice(1);

export function ModelSheet({
  visible,
  onClose,
  models,
  selected,
  onSelect,
  loaded,
  onRefresh,
}: Props) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { height: windowHeight } = useWindowDimensions();

  // Outlives `visible` so the exit has something to animate.
  const [mounted, setMounted] = useState(visible);
  const progress = useSharedValue(0);

  /*
   * The keyboard's height, measured, because nothing else in this tree knows about
   * it. The sheet is inside a `statusBarTranslucent` Modal -- its own window, laid
   * out over the whole screen and deliberately not resized when the keyboard opens --
   * so the search field can raise a keyboard over the sheet's own rows and neither
   * the safe-area inset nor a KeyboardAvoidingView would report a point of it. Which
   * is what the search field did: type a query and the one row that matched was
   * behind the keys.
   */
  const [keyboard, setKeyboard] = useState(0);

  useEffect(() => {
    if (!mounted) return;

    // `Will` on iOS so the sheet moves with the keyboard rather than after it;
    // Android has no such event and reports the frame once it is already up.
    const rising = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const falling = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const shown = Keyboard.addListener(rising, (event) => {
      const height = event.endCoordinates?.height ?? 0;
      setKeyboard(height > KEYBOARD_MIN_HEIGHT ? height : 0);
    });
    const hidden = Keyboard.addListener(falling, () => setKeyboard(0));

    return () => {
      shown.remove();
      hidden.remove();
    };
  }, [mounted]);

  /*
   * How tall the visible card may be, and how tall its box is.
   *
   * The keyboard is applied as bottom padding rather than by shrinking the box: the
   * sheet is anchored to the bottom edge, so padding is what lifts the rows clear of
   * the keys while the card's own fill still runs behind them -- no strip of scrim
   * between the sheet and the keyboard. `maxHeight` therefore has to carry that
   * padding on top of the content's cap, or a full list would be cropped by exactly
   * the keyboard twice over.
   */
  const bottomInset = keyboard > 0 ? keyboard : Math.max(insets.bottom, 12);
  const contentMax = Math.max(
    MIN_CONTENT_HEIGHT,
    Math.min(windowHeight * MAX_HEIGHT_RATIO, windowHeight - keyboard - insets.top - TOP_GAP),
  );
  const maxHeight = contentMax + bottomInset;

  const [query, setQuery] = useState('');
  const [provider, setProvider] = useState<string | null>(null);

  /*
   * The refresh button's two states. `failed` clears on the next attempt, so the
   * note under the title is only ever about the most recent try.
   */
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);

  /*
   * One full turn per second while a read is in flight, and the glyph is left where
   * it stopped when it ends -- snapping back to 0deg reads as the spin being undone.
   */
  const spin = useSharedValue(0);
  useEffect(() => {
    if (refreshing) {
      spin.value = withRepeat(
        withTiming(spin.value + 360, { duration: 900, easing: Easing.linear }),
        -1,
        false,
      );
    } else {
      cancelAnimation(spin);
    }
  }, [refreshing, spin]);

  const spinStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spin.value}deg` }],
  }));

  const refresh = useCallback(() => {
    if (refreshing) return;
    setRefreshing(true);
    setFailed(false);
    void onRefresh()
      .then((ok) => setFailed(!ok))
      .finally(() => setRefreshing(false));
  }, [onRefresh, refreshing]);

  const showTools = models.length >= TOOLS_THRESHOLD;

  /*
   * Providers, from the same slug the mark is drawn from -- so a chip and an icon
   * can never disagree about what a model is. Grouping on the payload's `owned_by`
   * would put every combo in one group called "combo", which is no filter at all.
   */
  const providers = useMemo(() => {
    const seen = new Set<string>();
    for (const model of models) {
      const slug = iconSlug(model.id);
      if (slug) seen.add(slug);
    }
    return [...seen].sort();
  }, [models]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return models.filter((model) => {
      if (provider && iconSlug(model.id) !== provider) return false;
      if (!needle) return true;
      // Both, because a user may type either the pretty name or the raw id.
      return (
        model.label.toLowerCase().includes(needle) || model.id.toLowerCase().includes(needle)
      );
    });
  }, [models, provider, query]);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      progress.value = withTiming(1, { duration: OPEN_DURATION, easing: EASE_OUT });
    } else {
      progress.value = withTiming(0, { duration: CLOSE_DURATION, easing: EASE_IN }, (finished) => {
        if (finished) runOnJS(setMounted)(false);
      });
    }
  }, [visible, progress]);

  // A filter left on from last time would hide models on the next open, and a stale
  // failure note would describe a read from whenever the sheet was last up.
  useEffect(() => {
    if (!visible) {
      setQuery('');
      setProvider(null);
      setFailed(false);
      // The next open starts with no keyboard; a height left over from this one would
      // be applied for the frame before the listener corrects it.
      setKeyboard(0);
    }
  }, [visible]);

  const requestClose = useCallback(() => onClose(), [onClose]);

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(progress.value, [0, 1], [maxHeight, 0]) }],
  }));

  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value * 0.5 }));

  /*
   * Drag down to dismiss, on the header only -- the list keeps its own scroll.
   *
   * Tracked against `maxHeight`, which is the distance the box travels, so the sheet
   * stays under the finger. Decided against `contentMax`, which is the card you can
   * see: with a keyboard up the box also spans the keyboard, and thresholding on that
   * would silently ask for a 200pt+ drag to dismiss the same sheet.
   */
  const pan = Gesture.Pan()
    .activeOffsetY(10)
    .failOffsetX([-24, 24])
    .onUpdate((event) => {
      progress.value = Math.max(0, 1 - Math.max(0, event.translationY) / maxHeight);
    })
    .onEnd((event) => {
      const shouldClose =
        event.translationY > contentMax * CLOSE_FRACTION || event.velocityY > CLOSE_VELOCITY;
      if (shouldClose) {
        progress.value = withTiming(0, { duration: CLOSE_DURATION, easing: EASE_IN });
        runOnJS(requestClose)();
      } else {
        progress.value = withTiming(1, { duration: OPEN_DURATION, easing: EASE_OUT });
      }
    });

  if (!mounted) return null;

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={requestClose}
    >
      {/* Gestures inside a Modal need their own root on Android. */}
      <GestureHandlerRootView style={styles.root}>
        <Animated.View style={[styles.scrimLayer, scrimStyle]}>
          <Pressable
            style={styles.scrim}
            onPress={requestClose}
            accessibilityRole="button"
            accessibilityLabel="Close model picker"
          />
        </Animated.View>

        <Animated.View
          style={[
            styles.sheet,
            {
              maxHeight,
              backgroundColor: colors.groupedCard,
              paddingBottom: bottomInset,
            },
            sheetStyle,
          ]}
        >
          <GestureDetector gesture={pan}>
            <View style={styles.header}>
              <View style={[styles.grabber, { backgroundColor: colors.separatorOpaque }]} />

              <View style={styles.titleRow}>
                <View style={styles.titleText}>
                  <AppText variant="title3Bold">Model</AppText>
                  {/*
                   * Only ever shown after a failed press. The list underneath is the
                   * one from before the attempt, so this says the refresh did not
                   * happen -- not that anything on screen is wrong.
                   */}
                  {failed ? (
                    <AppText variant="footnote" tone="tertiary">
                      Could not reach the server
                    </AppText>
                  ) : null}
                </View>

                {/*
                 * Re-reads the list from the proxy, past both caches.
                 *
                 * Here rather than on the chip that opens this sheet: opening a list
                 * is not a request to re-read it, and forcing an upstream call on
                 * every open spends the proxy's rate limit on the case where nothing
                 * changed. Pressed deliberately, it is also the only version of this
                 * that has somewhere to report a failure.
                 */}
                <Pressable
                  onPress={refresh}
                  hitSlop={10}
                  disabled={refreshing}
                  style={({ pressed }) => [
                    styles.refresh,
                    { backgroundColor: colors.fillQuaternary, opacity: pressed ? 0.6 : 1 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Refresh the model list"
                  accessibilityState={{ busy: refreshing, disabled: refreshing }}
                >
                  <Animated.View style={spinStyle}>
                    <Icon name="refresh-cw" size={17} color={colors.labelSecondary} />
                  </Animated.View>
                </Pressable>
              </View>
            </View>
          </GestureDetector>

          {showTools ? (
            <View style={styles.tools}>
              <View style={[styles.search, { backgroundColor: colors.fillQuaternary }]}>
                <Feather name="search" size={16} color={colors.labelTertiary} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search models"
                  placeholderTextColor={colors.labelTertiary}
                  style={[
                    typeTokens.bodyRegular,
                    styles.searchField,
                    { color: colors.labelPrimary },
                  ]}
                  autoCorrect={false}
                  autoCapitalize="none"
                  returnKeyType="search"
                  accessibilityLabel="Search models"
                />
              </View>

              {/* Only worth showing when there is more than one thing to filter to. */}
              {providers.length > 1 ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chips}
                  keyboardShouldPersistTaps="handled"
                >
                  <Chip
                    label="All"
                    active={provider === null}
                    onPress={() => setProvider(null)}
                  />
                  {providers.map((slug) => (
                    <Chip
                      key={slug}
                      label={titleCase(slug)}
                      active={provider === slug}
                      onPress={() => setProvider(provider === slug ? null : slug)}
                    />
                  ))}
                </ScrollView>
              ) : null}
            </View>
          ) : null}

          {/*
           * `keyboardShouldPersistTaps` is the other half of searching: with a
           * keyboard up, the default swallows the first tap to dismiss it, so
           * picking the row you just searched for takes two presses.
           */}
          <ScrollView
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {shown.map((model, index) => (
              <Pressable
                key={model.id}
                onPress={() => {
                  onSelect(model.id);
                  onClose();
                }}
                style={({ pressed }) => [
                  styles.row,
                  index > 0 ? styles.rowDivided : null,
                  index > 0 ? { borderTopColor: colors.separatorNonOpaque } : null,
                  { backgroundColor: pressed ? colors.rowActive : 'transparent' },
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: model.id === selected }}
                accessibilityLabel={model.label}
              >
                <ProviderMark modelId={model.id} label={model.label} size={24} />
                <AppText variant="bodyRegular" numberOfLines={1} style={styles.rowLabel}>
                  {model.label}
                </AppText>
                {model.id === selected ? (
                  <Icon name="check" size={18} color={colors.labelPrimary} />
                ) : null}
              </Pressable>
            ))}

            {/*
             * Three different nothings, said differently. "Not configured" is the one
             * worth spelling out: it is not a failure of the app, and it names where
             * to go and fix it.
             */}
            {shown.length === 0 ? (
              <View style={styles.empty}>
                <AppText variant="bodyRegular" tone="secondary">
                  {!loaded
                    ? 'Loading models…'
                    : models.length === 0
                      ? 'No models configured. Enable one in the server.'
                      : 'No models match.'}
                </AppText>
              </View>
            ) : null}
          </ScrollView>
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

/** One provider filter. Flat, and filled while it is the active one. */
function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: active ? colors.fillPrimary : colors.fillQuaternary,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
    >
      <AppText variant="footnote" tone={active ? 'primary' : 'secondary'}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  scrimLayer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  scrim: { flex: 1, backgroundColor: '#000000' },
  sheet: {
    // Only the top corners: the sheet is flush with the bottom edge.
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  header: { paddingTop: 8, paddingHorizontal: layout.screenPadding, paddingBottom: 10 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  // Takes the slack so the button stays pinned to the trailing edge whether or not
  // the failure note is showing.
  titleText: { flex: 1 },
  /*
   * Same 32pt circle and same quaternary fill as the search field it sits above, so
   * the two read as one row of controls rather than as a button bolted onto a title.
   */
  refresh: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
    opacity: 0.5,
  },
  tools: { paddingHorizontal: layout.screenPadding, gap: 10, paddingBottom: 4 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 36,
  },
  // Zeroed padding: the row above sets the height, and Android's own field padding
  // would push the text off that centre line.
  searchField: { flex: 1, paddingVertical: 0 },
  chips: { flexDirection: 'row', gap: 8, paddingRight: layout.screenPadding },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14 },
  list: { paddingHorizontal: layout.screenPadding },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13 },
  rowDivided: { borderTopWidth: StyleSheet.hairlineWidth },
  // Takes the slack, so the check stays pinned to the trailing edge.
  rowLabel: { flex: 1 },
  empty: { paddingVertical: 20, alignItems: 'center' },
});
