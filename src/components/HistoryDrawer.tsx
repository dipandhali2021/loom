import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { Icon } from './Icon';
import { AppText } from './AppText';
import { useTheme } from '../theme/ThemeProvider';
import { useChatStore } from '../store/ChatStore';
import { layout, palette } from '../theme/tokens';

type Props = {
  visible: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
};

const PANEL_MAX_WIDTH = 330;
const PANEL_WIDTH_RATIO = 0.82;

// Asymmetric on purpose: opening wants to feel eager, closing wants to get out
// of the way, and iOS-style deceleration on both keeps the edge from snapping.
const OPEN_DURATION = 280;
const CLOSE_DURATION = 220;
const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1);
const EASE_IN = Easing.bezier(0.4, 0, 1, 1);

const AVATAR_SIZE = 36;

/**
 * How tall the ramp at the foot of the list is.
 *
 * Roughly a row and a half, so a title is already half gone by the time it
 * reaches the bar. Shorter than that and the fade reads as a hard edge again;
 * taller and it starts dimming rows you are trying to read.
 */
const LIST_FADE_HEIGHT = 56;

/**
 * Stops of a smoothstep, sampled -- the same ramp `TopFade` uses at the other end
 * of the chat screen. A straight two-stop gradient bands visibly and its midpoint
 * reads as an edge, which is the one thing this is here to avoid.
 */
const FADE_STOPS = [0, 0.18, 0.34, 0.5, 0.64, 0.78, 0.9, 1].map((t) => ({
  offset: t,
  // 0 at the top of the ramp, 1 where it meets the bar.
  opacity: t * t * (3 - 2 * t),
}));

/**
 * Up to two letters for the account avatar, from the address' local part.
 *
 * The store carries an email and nothing else -- no display name, no Clerk
 * `imageUrl` -- so the address is all there is to initial. Separators inside the
 * local part are treated as word breaks ("ada.lovelace" -> "AL"), and digits are
 * skipped so "dipandhali2021" is "D" rather than "D2".
 */
function initialsFor(email: string | null): string {
  const local = (email ?? '').split('@')[0];
  const letters = local
    .split(/[^a-zA-Z]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase());
  // An address with no letters at all still needs something in the circle.
  return letters.length > 0 ? letters.join('') : '?';
}

/**
 * The ramp the list scrolls out through, sitting on the seam between the last row
 * and the bar below it.
 *
 * The bar has no hairline of its own any more: a rule plus a scroll edge is two
 * lines saying one thing. This paints the panel's own colour, transparent at the
 * top and solid where it meets the bar, so a title on its way past dissolves
 * instead of being cut off by a border.
 */
function ListFade() {
  const { colors } = useTheme();

  const stops = useMemo(
    () =>
      FADE_STOPS.map((stop) => (
        <Stop
          key={stop.offset}
          offset={stop.offset}
          stopColor={colors.bgPrimary}
          stopOpacity={stop.opacity}
        />
      )),
    [colors.bgPrimary],
  );

  return (
    <View style={styles.fade} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          {/* Vertical: `x1 === x2`, top to bottom in the gradient's own box. */}
          <LinearGradient id="listFade" x1="0" y1="0" x2="0" y2="1">
            {stops}
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#listFade)" />
      </Svg>
    </View>
  );
}

/** One conversation. A title and nothing else; the section above says the rest. */
function ChatRow({
  title,
  active,
  onPress,
  onLongPress,
}: {
  title: string;
  active: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.item,
        {
          backgroundColor: active ? colors.rowActive : 'transparent',
          opacity: pressed ? 0.6 : 1,
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint="Long press to delete"
    >
      <AppText variant="bodyRegular" numberOfLines={1}>
        {title}
      </AppText>
    </Pressable>
  );
}

/**
 * Chat history drawer reached from the nav bar's menu button: the app's name, the
 * pinned chats when there are any, then the rest, over a bar carrying the
 * new-chat pill and the account avatar.
 *
 * Pinned chats get their own labelled section rather than a pin glyph on each
 * row -- being under a "Pinned" heading is the same fact, said once. `Chats` is
 * labelled too, so the list reads the same whether or not that block is above it.
 *
 * The panel slides in from the left edge. `Modal`'s own `animationType` only
 * offers a bottom sheet, so the modal is presented without animation and the
 * transform is driven here -- which also lets the scrim fade in step with the
 * panel and lets a leftward drag close it.
 */
export function HistoryDrawer({ visible, onClose, onOpenSettings }: Props) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const { visibleConversations, activeId, openConversation, newConversation, deleteConversation, email } =
    useChatStore();

  const panelWidth = Math.min(windowWidth * PANEL_WIDTH_RATIO, PANEL_MAX_WIDTH);

  /*
   * `visibleConversations` already arrives pinned-first, so this is a partition
   * and not a sort: each section keeps the recency order the store put it in.
   */
  const [pinned, rest] = useMemo(
    () => [
      visibleConversations.filter((c) => c.pinned),
      visibleConversations.filter((c) => !c.pinned),
    ],
    [visibleConversations],
  );

  const initials = useMemo(() => initialsFor(email), [email]);

  // The modal has to outlive `visible` so the exit animation has something to
  // animate; `mounted` is what actually keeps it on screen.
  const [mounted, setMounted] = useState(visible);
  // 0 = fully off-screen left, 1 = fully open. Everything reads off this.
  const progress = useSharedValue(0);

  // Keyed on `visible` alone: re-running when `mounted` flips would re-target an
  // in-flight animation and stretch it over a second full duration.
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

  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(progress.value, [0, 1], [-panelWidth, 0]) }],
  }));

  const scrimStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
  }));

  const requestClose = useCallback(() => {
    onClose();
  }, [onClose]);

  /*
   * Drag-to-close. Only leftward travel counts (the panel is already at its
   * open position, so a rightward drag has nowhere to go), and the release
   * either commits past a third of the width / a decisive flick, or springs
   * back. `visible` stays true on cancel, so the effect above will not fight it.
   */
  const pan = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .failOffsetY([-24, 24])
    .onUpdate((event) => {
      const dragged = Math.min(0, event.translationX);
      progress.value = 1 + dragged / panelWidth;
    })
    .onEnd((event) => {
      const shouldClose = event.translationX < -panelWidth / 3 || event.velocityX < -500;
      if (shouldClose) {
        progress.value = withTiming(0, { duration: CLOSE_DURATION, easing: EASE_IN });
        runOnJS(requestClose)();
      } else {
        progress.value = withTiming(1, { duration: OPEN_DURATION, easing: EASE_OUT });
      }
    });

  if (!mounted) return null;

  const openAndClose = (id: string) => {
    openConversation(id);
    requestClose();
  };

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={requestClose}>
      {/* Gestures inside a Modal need their own root on Android. */}
      <GestureHandlerRootView style={styles.root}>
        <Animated.View style={[styles.scrimLayer, scrimStyle]}>
          <Pressable
            style={styles.scrim}
            onPress={requestClose}
            accessibilityRole="button"
            accessibilityLabel="Close chat history"
          />
        </Animated.View>

        <GestureDetector gesture={pan}>
          <Animated.View
            style={[
              styles.panel,
              {
                width: panelWidth,
                backgroundColor: colors.bgPrimary,
                borderRightColor: colors.separatorNonOpaque,
                paddingTop: insets.top + 12,
              },
              panelStyle,
            ]}
          >
            <View style={styles.header}>
              <AppText variant="largeTitle">Loom</AppText>
            </View>

            {/* The fade is a sibling of the scroll view, not a child: inside it, it
                would scroll away with the content it is meant to cover. */}
            <View style={styles.listWrap}>
              <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
                {visibleConversations.length === 0 ? (
                  <AppText variant="bodyRegular" tone="secondary" style={styles.empty}>
                    No chats yet.
                  </AppText>
                ) : (
                  <>
                    {/* Only when there are any: an empty "Pinned" heading would
                        advertise a feature by showing nothing under it. */}
                    {pinned.length > 0 ? (
                      <>
                        <AppText variant="title3Bold" style={styles.section}>
                          Pinned
                        </AppText>
                        {pinned.map((conversation) => (
                          <ChatRow
                            key={conversation.id}
                            title={conversation.title}
                            active={conversation.id === activeId}
                            onPress={() => openAndClose(conversation.id)}
                            onLongPress={() => deleteConversation(conversation.id)}
                          />
                        ))}
                      </>
                    ) : null}

                    {rest.length > 0 ? (
                      <>
                        <AppText
                          variant="title3Bold"
                          style={[styles.section, pinned.length > 0 ? styles.sectionAfter : null]}
                        >
                          Chats
                        </AppText>
                        {rest.map((conversation) => (
                          <ChatRow
                            key={conversation.id}
                            title={conversation.title}
                            active={conversation.id === activeId}
                            onPress={() => openAndClose(conversation.id)}
                            onLongPress={() => deleteConversation(conversation.id)}
                          />
                        ))}
                      </>
                    ) : null}
                  </>
                )}
              </ScrollView>
              <ListFade />
            </View>

            <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 16) }]}>
              <Pressable
                onPress={() => {
                  newConversation();
                  requestClose();
                }}
                style={({ pressed }) => [
                  styles.pill,
                  { backgroundColor: colors.accent, opacity: pressed ? 0.7 : 1 },
                ]}
                accessibilityRole="button"
                accessibilityLabel="New chat"
              >
                <Icon name="edit" size={18} color={colors.accentOn} />
                <AppText variant="calloutSemibold" tone="none" style={{ color: colors.accentOn }}>
                  New chat
                </AppText>
              </Pressable>

              <Pressable
                onPress={() => {
                  requestClose();
                  onOpenSettings();
                }}
                style={({ pressed }) => [styles.avatar, { opacity: pressed ? 0.7 : 1 }]}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={email ? `Account: ${email}` : 'Account'}
                accessibilityHint="Opens settings"
              >
                <AppText variant="caption1Medium" tone="none" style={styles.avatarLabel}>
                  {initials}
                </AppText>
              </Pressable>
            </View>
          </Animated.View>
        </GestureDetector>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  // The scrim covers the whole screen and the panel is absolutely positioned on
  // top of it, so the panel's transform never shifts the scrim with it.
  scrimLayer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  // The panel matches the page, so a hairline is what separates it from the
  // transcript behind, and the scrim leans darker to make that edge legible.
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  // Taller than the chat bar it used to line up with: a 34pt wordmark needs the
  // room, and nothing sits beside it now to line up with anyway.
  header: { paddingHorizontal: layout.screenPadding, paddingTop: 8, paddingBottom: 12 },
  // Takes the space between the header and the bar, and clips the fade to it.
  listWrap: { flex: 1 },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: LIST_FADE_HEIGHT },
  // Bottom padding is the fade's height: the last row has to be scrollable clear
  // of the ramp, or it can never be read at full strength.
  list: { paddingHorizontal: 8, paddingBottom: LIST_FADE_HEIGHT, gap: 2 },
  empty: { paddingHorizontal: 8, paddingVertical: 12 },
  // Aligned with the row labels rather than the wordmark, so the heading and the
  // titles it covers share one left edge.
  section: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 8 },
  /** Extra air above "Chats" only when a Pinned block ends right before it. */
  sectionAfter: { paddingTop: 24 },
  item: {
    justifyContent: 'center',
    paddingHorizontal: 12,
    minHeight: 44,
    borderRadius: 10,
  },
  // No hairline: the fade above it is what separates the bar from the list.
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
    paddingHorizontal: layout.screenPadding,
    paddingTop: 12,
  },
  // Hugs its label rather than filling the bar: the two controls are separate
  // actions, and a pill stretched to the avatar reads as one wide bar with a
  // circle bitten out of the end.
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: AVATAR_SIZE,
    paddingHorizontal: 18,
    borderRadius: AVATAR_SIZE / 2,
  },
  avatar: {
    // Pushed to the far edge, so the pill's width no longer decides where it sits.
    marginLeft: 'auto',
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.avatarOrange,
  },
  avatarLabel: { color: palette.white },
});
