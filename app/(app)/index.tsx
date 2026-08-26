import React, { useCallback, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavBar } from '../../src/components/NavBar';
import { Composer } from '../../src/components/Composer';
import { MessageRow } from '../../src/components/MessageRow';
import { ModelPicker } from '../../src/components/ModelPicker';
import { HistoryDrawer } from '../../src/components/HistoryDrawer';
import { TopFade } from '../../src/components/TopFade';
import { EmptyChat } from '../../src/components/EmptyChat';
import { useTheme } from '../../src/theme/ThemeProvider';
import { useChatStore } from '../../src/store/ChatStore';
import { layout } from '../../src/theme/tokens';

const MODEL_LABEL = { 'gpt-3.5': '3.5', 'gpt-4': '4', 'gpt-5': '5' } as const;

/**
 * How far from the bottom still counts as "at the bottom".
 *
 * Scrolling up by more than this is taken as the user wanting to read back, and
 * the transcript stops following the stream until they return. One line of body
 * text, so a stray flick does not strand them mid-reply.
 */
const STICK_SLOP = 28;

/**
 * The chat screen, following the ChatGPT Apps UI Kit (rR8Yz5BLDtLM1EKCPalwY3,
 * 4420:1535). Main view / typing / getting-answer / scrolling are all this one
 * screen, differing only by whether a transcript exists and whether a reply is
 * streaming.
 */
export default function ChatScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const {
    messages,
    model,
    setModel,
    sendMessage,
    stopStreaming,
    isStreaming,
    temporary,
    setTemporary,
  } = useChatStore();

  const [draft, setDraft] = useState('');
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  /*
   * `messages` comes from the store rather than from `active`: in temporary mode the
   * turns live outside the persisted state entirely, and the store is what knows
   * which list is the one on screen.
   */
  const isEmpty = messages.length === 0;

  /** False once the user scrolls up to read back; true again when they return. */
  const stick = useRef(true);

  /*
   * Follow the stream as tokens land, the way the Scrolling frame is pinned to
   * the newest turn. Driven by content size rather than by message text, because
   * the reveal grows the transcript every frame and an effect keyed on its length
   * would queue a fresh animated scroll on each one -- they fight, and the list
   * stutters. `animated: false` for the same reason: the growth is already
   * gradual, so each step is a small jump that reads as a smooth follow.
   */
  const follow = useCallback(() => {
    if (isEmpty || !stick.current) return;
    scrollRef.current?.scrollToEnd({ animated: false });
  }, [isEmpty]);

  /*
   * The frame changing matters as much as the content changing, and this is the
   * half that was missing: the keyboard opening and the composer growing to a
   * second line both shorten the scroll view without adding any content, so
   * `onContentSizeChange` never fires and whatever was at the bottom ends up
   * behind the type box. Re-pinning on layout is what keeps the newest turn above
   * it. Scheduled a frame out because the size in hand here is the one being
   * applied -- scrolling inside the same pass lands against the old height.
   */
  const onLayout = useCallback(() => {
    requestAnimationFrame(follow);
  }, [follow]);

  /*
   * Only a scroll the user drove changes whether the transcript follows.
   *
   * This is the part that has to be exact: the keyboard opening shortens the view
   * without moving the content, which leaves the tail off-screen and looks
   * identical to having scrolled up. Reading that as intent would switch following
   * off at the very moment it is needed, so the offset is consulted while a finger
   * is on the screen and at the end of a flick, and ignored otherwise.
   */
  const dragging = useRef(false);

  const measure = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    stick.current = contentSize.height - layoutMeasurement.height - contentOffset.y <= STICK_SLOP;
  };

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (dragging.current) measure(event);
  };

  /*
   * Sending always returns to the tail, whatever the user was reading: their own
   * turn appearing somewhere off-screen is the one case where following is not a
   * preference. Two frames out, since the row has to be laid out before there is
   * an end to scroll to.
   */
  const onSubmit = (text: string) => {
    setDraft('');
    sendMessage(text);
    stick.current = true;
    requestAnimationFrame(() => requestAnimationFrame(follow));
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.bgPrimary }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {isEmpty ? (
          <View style={[styles.emptyBody, { paddingTop: insets.top + layout.chatNavBarHeight }]}>
            <EmptyChat temporary={temporary} />
          </View>
        ) : (
          <ScrollView
            ref={scrollRef}
            style={styles.flex}
            contentContainerStyle={[
              styles.transcript,
              { paddingTop: insets.top + layout.chatNavBarHeight + 6 },
            ]}
            showsVerticalScrollIndicator={false}
            keyboardDismissMode="interactive"
            onContentSizeChange={follow}
            onLayout={onLayout}
            onScroll={onScroll}
            onScrollBeginDrag={() => {
              dragging.current = true;
            }}
            onScrollEndDrag={(event) => {
              dragging.current = false;
              measure(event);
            }}
            onMomentumScrollEnd={measure}
            scrollEventThrottle={16}
          >
            {messages.map((message) => (
              <MessageRow key={message.id} message={message} />
            ))}
          </ScrollView>
        )}

        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 8) }]}>
          {/*
           * No starter chips above the type box. They filled the draft with a canned
           * sentence, which is a different thing from asking your own question, and on
           * an empty screen they were the loudest element on it -- so the composer had
           * to compete with two cards for the attention of someone about to type.
           */}
          <Composer
            value={draft}
            onChangeText={setDraft}
            onSubmit={onSubmit}
            onStop={stopStreaming}
            isStreaming={isStreaming}
            placeholder={temporary ? 'Temporary chat' : 'Ask anything'}
            onOpenVoice={() => router.push('/voice')}
          />
        </View>
      </KeyboardAvoidingView>

      {/*
       * The bar has no fill of its own: the transcript runs the full height of the
       * screen and dissolves into this gradient on its way up, which is what puts
       * the chat under the bar instead of stopping below it.
       */}
      <TopFade />
      <View style={styles.navBarLayer} pointerEvents="box-none">
        <NavBar
          modelBadge={MODEL_LABEL[model]}
          onPressMenu={() => setDrawerOpen(true)}
          onPressEdit={() => router.push('/new')}
          onPressTitle={() => setModelPickerOpen(true)}
          onPressMore={() => router.push('/settings')}
          /*
           * The right slot holds the temporary toggle while the chat is empty --
           * compose has nothing to start away from and the overflow menu nothing to
           * act on -- and hands back to that pair once turns exist. The `|| temporary`
           * is what keeps a temporary chat legible after its first reply: the toggle
           * is the only thing on screen saying this conversation is not being kept,
           * and the only way back out of it.
           *
           * So the offer to *enter* the mode is confined to an empty chat, which is
           * the only place it means anything: a chat that has already sent a turn
           * cannot retroactively not have stored it.
           */
          showTemporary={isEmpty || temporary}
          temporary={temporary}
          onToggleTemporary={() => setTemporary(!temporary)}
        />
      </View>

      <ModelPicker
        visible={modelPickerOpen}
        selected={model}
        onSelect={setModel}
        onClose={() => setModelPickerOpen(false)}
        topOffset={insets.top + layout.chatNavBarHeight + 4}
      />
      <HistoryDrawer
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onOpenSettings={() => router.push('/settings')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  emptyBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: layout.chatPadding,
  },
  // 12pt of tail keeps the last turn's action row clear of the composer.
  transcript: { paddingBottom: 12 },
  // Sits above the fade, so the icons stay at full strength.
  navBarLayer: { position: 'absolute', top: 0, left: 0, right: 0 },
  footer: { gap: 10, paddingTop: 6 },
});
