import React, { useCallback, useEffect, useState } from 'react';
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
import { Icon } from './Icon';
import { AppText } from './AppText';
import { useTheme } from '../theme/ThemeProvider';
import { useChatStore } from '../store/ChatStore';
import { layout } from '../theme/tokens';

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

/**
 * Chat history drawer reached from the nav bar's menu button. The Figma template
 * shows the menu affordance but not the panel itself, so this follows the app's
 * own sidebar: a list of conversations over a scrim, with settings pinned below.
 *
 * The panel slides in from the left edge. `Modal`'s own `animationType` only
 * offers a bottom sheet, so the modal is presented without animation and the
 * transform is driven here — which also lets the scrim fade in step with the
 * panel and lets a leftward drag close it.
 */
export function HistoryDrawer({ visible, onClose, onOpenSettings }: Props) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const { visibleConversations, activeId, openConversation, newConversation, deleteConversation, email } =
    useChatStore();

  const panelWidth = Math.min(windowWidth * PANEL_WIDTH_RATIO, PANEL_MAX_WIDTH);

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
              <AppText variant="bodySemibold">Chats</AppText>
              <Pressable
                onPress={() => {
                  newConversation();
                  requestClose();
                }}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="New chat"
              >
                <Icon name="edit" size={22} color={colors.labelPrimary} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
              {visibleConversations.length === 0 ? (
                <AppText variant="bodyRegular" tone="secondary" style={styles.empty}>
                  No chats yet.
                </AppText>
              ) : (
                visibleConversations.map((conversation) => (
                  <Pressable
                    key={conversation.id}
                    onPress={() => {
                      openConversation(conversation.id);
                      requestClose();
                    }}
                    onLongPress={() => deleteConversation(conversation.id)}
                    style={({ pressed }) => [
                      styles.item,
                      {
                        backgroundColor:
                          conversation.id === activeId ? colors.rowActive : 'transparent',
                        opacity: pressed ? 0.6 : 1,
                      },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={conversation.title}
                    accessibilityHint="Long press to delete"
                  >
                    <AppText variant="bodyRegular" numberOfLines={1}>
                      {conversation.title}
                    </AppText>
                  </Pressable>
                ))
              )}
            </ScrollView>

            <Pressable
              onPress={() => {
                requestClose();
                onOpenSettings();
              }}
              style={({ pressed }) => [
                styles.footer,
                {
                  borderTopColor: colors.separatorNonOpaque,
                  opacity: pressed ? 0.6 : 1,
                  paddingBottom: Math.max(insets.bottom, 16),
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Open settings"
            >
              <Icon name="database-01" size={20} color={colors.labelPrimary} />
              <AppText variant="bodyRegular" numberOfLines={1} style={styles.footerLabel}>
                {email ?? 'Account'}
              </AppText>
              <Icon name="chevron-left" size={13} color={colors.labelTertiary} style={styles.chevron} />
            </Pressable>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: layout.screenPadding,
    // Matches the chat screen's bar so the drawer's header lines up with it.
    height: layout.chatNavBarHeight,
  },
  list: { paddingHorizontal: 8, paddingVertical: 8, gap: 2 },
  empty: { paddingHorizontal: 8, paddingVertical: 12 },
  item: { paddingHorizontal: 12, paddingVertical: 12, borderRadius: 10 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: layout.screenPadding,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerLabel: { flex: 1 },
  chevron: { transform: [{ rotate: '180deg' }] },
});
