import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as Haptics from 'expo-haptics';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavBar } from '../../src/components/NavBar';
import { Composer } from '../../src/components/Composer';
import { MessageRow } from '../../src/components/MessageRow';
import { ModelSheet } from '../../src/components/ModelSheet';
import { HistoryDrawer } from '../../src/components/HistoryDrawer';
import { TopFade } from '../../src/components/TopFade';
import { EmptyChat } from '../../src/components/EmptyChat';
import { AttachmentSheet } from '../../src/components/AttachmentSheet';
import { ChatMenu, type ChatMenuItem } from '../../src/components/ChatMenu';
import { FindBar, FIND_BAR_HEIGHT } from '../../src/components/FindBar';
import { useTheme } from '../../src/theme/ThemeProvider';
import { useChatStore } from '../../src/store/ChatStore';
import { useAttachments } from '../../src/lib/useAttachments';
import { useDictation } from '../../src/lib/useDictation';
import { deriveModelLabel } from '../../src/lib/modelLabel';
import { findMatches } from '../../src/lib/find';
import { toShareText } from '../../src/lib/transcript';
import { layout, palette } from '../../src/theme/tokens';

/**
 * How far from the bottom still counts as "at the bottom".
 *
 * Scrolling up by more than this is taken as the user wanting to read back, and
 * the transcript stops following the stream until they return. One line of body
 * text, so a stray flick does not strand them mid-reply.
 */
const STICK_SLOP = 28;

/**
 * Stand-in height for the attachment panel until a keyboard has been measured.
 *
 * Only ever used on the very first open of a fresh launch where the field was
 * never focused -- reachable, since the "+" does not need the keyboard first. Gboard
 * and the iOS keyboard both land near this on a phone, so the panel is the right
 * size rather than the wrong size, and every subsequent open uses the real number.
 */
const FALLBACK_KEYBOARD_HEIGHT = 290;

/**
 * How long to wait for the keyboard after asking for it, before giving up and
 * closing the panel on its own animation.
 *
 * Only reached when `keyboardDidShow` never arrives: a hardware keyboard is
 * attached, or the field refused focus. Long enough to cover a slow keyboard app
 * cold-starting, short enough that the panel does not look stuck if it never comes.
 */
const KEYBOARD_WAIT_MS = 550;

/** The panel's own timings, mirrored from AttachmentSheet so the footer can match. */
const PANEL_OPEN_MS = 260;
const PANEL_CLOSE_MS = 200;

/**
 * Air under the composer while something is covering the bottom of the screen.
 *
 * The safe-area inset is there to clear a home indicator or a gesture bar, and a
 * keyboard or the attachment panel is already over that region -- so applying the
 * full inset on top is 20-34pt of daylight between the type box and the keys. 4pt
 * is enough that the pill does not touch them.
 */
const COVERED_GAP = 4;

/**
 * The chat screen. Main view / typing / getting-answer / scrolling are all this one
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
    webSearch,
    setWebSearch,
    models,
    modelsLoaded,
    refreshModels,
    authToken,
    active,
    setPinned,
    deleteConversation,
    hapticsEnabled,
  } = useChatStore();

  const [draft, setDraft] = useState('');

  /*
   * Files picked for the turn being typed, uploading in the background while it is
   * written. Owned here rather than in the composer because both the "+" panel (which
   * picks them) and the composer (which shows and sends them) need the same list, and
   * they are siblings.
   */
  const attachments = useAttachments(authToken);

  /*
   * Dictation appends rather than replaces: a transcript arriving over half a typed
   * sentence would delete it, and the mic is as often used to finish a thought as to
   * start one. `setDraft` with a function so two quick clips cannot race.
   */
  const dictation = useDictation(
    authToken,
    useCallback((text: string) => {
      setDraft((prev) => (prev.trim().length > 0 ? `${prev.replace(/\s+$/, '')} ${text}` : text));
    }, []),
  );
  const [modelSheetOpen, setModelSheetOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput | null>(null);

  /*
   * Find in chat. `findOpen` is the strip, `findQuery` what is in it, and `findAt`
   * which hit the chevrons are on -- an index into `findHits` rather than a message
   * id, because a single turn holds several hits and stepping has to walk them all.
   */
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findAt, setFindAt] = useState(0);

  /*
   * Where each turn sits in the transcript, so a hit can be scrolled to.
   *
   * A ref rather than state: it is written by every row's `onLayout`, and a row
   * re-rendering on each of those writes is the transcript re-rendering while it is
   * being laid out. Nothing reads it during render -- only a chevron does.
   */
  const rowOffsets = useRef(new Map<string, number>());

  const onRowLayout = useCallback((id: string, event: LayoutChangeEvent) => {
    rowOffsets.current.set(id, event.nativeEvent.layout.y);
  }, []);

  /*
   * The keyboard's own height, so the attachment panel is exactly as tall as the
   * thing it replaces. Measured rather than assumed: it varies by keyboard app, by
   * language, and by whether a suggestion strip is showing, and being 20pt out is
   * visible as the composer jumping when the two trade places.
   *
   * Recorded from whichever show event the platform has (below) and remembered after
   * the keyboard goes, since the panel is opened when there is nothing to measure.
   */
  const [keyboardHeight, setKeyboardHeight] = useState(FALLBACK_KEYBOARD_HEIGHT);

  /*
   * The composer's own bottom padding, animated rather than switched.
   *
   * It has to change -- the safe-area inset is wasted space once a keyboard is over
   * it -- but changing it in one commit is a second source of exactly the jitter
   * being fixed: the composer would drop 30pt the instant focus landed and then be
   * pushed back up as the inset grew. Driven off a shared value, it can be given
   * the keyboard's own duration and travel with it.
   */
  const restGap = Math.max(insets.bottom, 8);
  /*
   * 0 = the screen's own bottom edge is under the composer, 1 = something else is.
   * A ratio rather than the padding itself, so a rotation changing `restGap` is
   * picked up by the next frame without an effect having to chase it.
   */
  const covered = useSharedValue(0);
  const footerStyle = useAnimatedStyle(() => ({
    paddingBottom: restGap + covered.value * (COVERED_GAP - restGap),
  }));

  const setGap = useCallback(
    (next: boolean, ms: number) => {
      const target = next ? 1 : 0;
      // Linear for the same reason the panel's collapse is: the keyboard's inset
      // carries the easing, and a second curve on top of it bends the sum.
      covered.value = ms > 0 ? withTiming(target, { duration: ms, easing: Easing.linear }) : target;
    },
    [covered],
  );

  /*
   * The panel-to-keyboard handover.
   *
   * The composer sits above `panelHeight + keyboardInset`, so it only holds still
   * if those two always sum to the same number. That is the whole problem: the
   * panel's collapse and the keyboard's rise are separately timed animations over
   * the same run of pixels, and the difference between them was the composer
   * lifting and settling for about a second.
   *
   * So the panel is not collapsed when focus is requested. It is left standing --
   * it *is* the keyboard's height, which is why it was measured -- until the
   * keyboard's frame change is announced, and then it gives up exactly the duration
   * the keyboard reports for exactly the points the inset is taking.
   *
   * `handoff` is what is being waited for; `collapseMs`, once set, is how the panel
   * should leave, and setting it is also what closes the panel.
   */
  const [handoff, setHandoff] = useState(false);
  /*
   * Whether the panel is up, for the keyboard listeners. They are registered once,
   * so they cannot read `sheetOpen` -- and they need it *before* the render that
   * sets it, since `openSheet` dismisses the keyboard in the same tick it opens the
   * panel and the hide event has to already know the panel is coming.
   */
  const sheetOpenRef = useRef(false);
  // Mirrored for the listener, which is registered once and must not close over a
  // stale value.
  const handoffRef = useRef(false);
  const handoffTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [collapseMs, setCollapseMs] = useState<number | undefined>(undefined);

  /** Ends the handover, collapsing the panel over `ms` (0 = within one frame). */
  const finishHandoff = useCallback((ms: number | undefined) => {
    if (!handoffRef.current) return;
    handoffRef.current = false;
    if (handoffTimer.current) {
      clearTimeout(handoffTimer.current);
      handoffTimer.current = null;
    }
    sheetOpenRef.current = false;
    setCollapseMs(ms);
    setHandoff(false);
    setSheetOpen(false);
  }, []);

  useEffect(() => {
    /*
     * `keyboardWillShow` on iOS, `keyboardDidShow` on Android -- and the difference
     * is the point, not a portability workaround. iOS announces the frame change
     * before it animates and reports its duration, so the panel can be given the
     * same duration and shrink alongside it. Android has no `Will` event and does
     * not animate the resize at all: by the time `Did` arrives the window is already
     * short, so the panel has to vanish in that same commit (`0`) rather than
     * animate out of a space that no longer exists.
     */
    const rising = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';

    const shown = Keyboard.addListener(rising, (event) => {
      const height = event.endCoordinates?.height ?? 0;
      // A hardware keyboard reports a near-zero frame; that is not a panel height.
      if (height > 120) setKeyboardHeight(height);

      const duration = Platform.OS === 'ios' ? (event.duration ?? 0) : 0;
      if (height > 120) setGap(true, duration);

      /*
       * A keyboard that reports no height is not replacing the panel, so the panel
       * leaves on its own curve rather than being cut to make room for nothing.
       */
      if (height <= 120) {
        finishHandoff(undefined);
        return;
      }
      finishHandoff(duration);
    });

    /*
     * The panel taking the keyboard's place is also a keyboard hiding, and there the
     * inset must stay small -- the panel is over the same region. `sheetOpenRef` is
     * what tells the two cases apart.
     */
    const falling = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const hidden = Keyboard.addListener(falling, (event) => {
      if (sheetOpenRef.current) return;
      setGap(false, Platform.OS === 'ios' ? (event.duration ?? 0) : 0);
    });

    return () => {
      shown.remove();
      hidden.remove();
      if (handoffTimer.current) clearTimeout(handoffTimer.current);
    };
  }, [finishHandoff, setGap]);

  /*
   * The keyboard and the panel are alternatives, never both. Opening the panel
   * lowers the keyboard, and closing it with the "x" or a downward swipe raises it
   * again -- the user was mid-message, and taking the panel away to leave a blank
   * gap would be a third state neither of them asked for.
   */
  const openSheet = useCallback(() => {
    // Measured before dismissing: `metrics()` is empty once it is down, and this is
    // the path where a keyboard is actually up to measure.
    const metrics = Keyboard.metrics();
    if (metrics && metrics.height > 120) setKeyboardHeight(metrics.height);

    /*
     * Set before dismissing, so the hide listener firing in this same turn already
     * knows the panel is taking the keyboard's place and leaves the inset alone.
     */
    const fromKeyboard = Keyboard.isVisible();
    sheetOpenRef.current = true;
    Keyboard.dismiss();
    setCollapseMs(undefined);
    setSheetOpen(true);
    /*
     * Only when the keyboard was down. Coming from a keyboard the gap is already
     * closed, and re-animating it to where it is would be a visible nudge; coming
     * from nothing, the composer has to give up the safe-area inset over exactly the
     * span the panel takes to grow, or it drops 30pt a quarter-second early.
     */
    if (!fromKeyboard) setGap(true, PANEL_OPEN_MS);
  }, [setGap]);

  const closeSheet = useCallback(
    (restoreKeyboard: boolean) => {
      if (!restoreKeyboard) {
        // Nothing is replacing the panel, so it animates out on its own curve, and
        // the safe-area inset comes back over the same span.
        sheetOpenRef.current = false;
        setCollapseMs(undefined);
        setSheetOpen(false);
        setGap(false, PANEL_CLOSE_MS);
        return;
      }

      /*
       * The panel stays where it is; the keyboard's own frame event is what takes
       * it away. The timer is the only fallback path -- reached when no keyboard
       * ever arrives, because one is attached over USB or the field refused focus --
       * and it lets the panel leave on its own curve, since in that case nothing is
       * coming to fill the space.
       */
      handoffRef.current = true;
      setHandoff(true);
      inputRef.current?.focus();
      if (handoffTimer.current) clearTimeout(handoffTimer.current);
      handoffTimer.current = setTimeout(() => {
        // No keyboard came, so nothing is going to cover the bottom edge.
        sheetOpenRef.current = false;
        setGap(false, PANEL_CLOSE_MS);
        finishHandoff(undefined);
      }, KEYBOARD_WAIT_MS);
    },
    [finishHandoff, setGap],
  );

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
    // Read before clearing, and only the ones the pipeline finished with: a tile
    // still uploading is not part of this turn.
    const ready = attachments.ready;
    setDraft('');
    attachments.clear();
    /*
     * Sending is done with the panel: it is a pre-send control, and leaving it open
     * over the reply it configured would cover the transcript it belongs to. The
     * keyboard is not restored either, so the inset comes back with it.
     */
    sheetOpenRef.current = false;
    setCollapseMs(undefined);
    setSheetOpen(false);
    if (!Keyboard.isVisible()) setGap(false, PANEL_CLOSE_MS);
    sendMessage(text, ready);
    stick.current = true;
    requestAnimationFrame(() => requestAnimationFrame(follow));
  };

  /*
   * Every occurrence of the query, in reading order, recomputed as either changes.
   *
   * Over the transcript in hand rather than the stored conversation, so it searches
   * the right list in temporary mode too -- and so a reply still streaming becomes
   * searchable as it lands, which is what a reader scrolling back through a long
   * answer actually wants.
   */
  const findHits = useMemo(
    () => (findOpen ? findMatches(messages, findQuery) : []),
    [findOpen, findQuery, messages],
  );

  /*
   * Clamped rather than reset: a hit going away (the query grew, a reply was
   * regenerated) should leave the chevrons somewhere valid, and holding an index past
   * the end would show "12/4". Editing the query does start from the first hit again,
   * which is what the effect below is keyed on.
   */
  const findIndex = findHits.length > 0 ? Math.min(findAt, findHits.length - 1) : 0;
  const findHit = findHits[findIndex];

  /** Scrolls a hit to just under the find bar, where the eye already is. */
  const revealHit = useCallback(
    (messageId: string) => {
      const y = rowOffsets.current.get(messageId);
      if (y === undefined) return;
      // Following the stream and jumping to a hit are opposite intents; the jump wins
      // until the user returns to the tail on their own.
      stick.current = false;
      /*
       * The offsets are in content coordinates and the scroll view runs the full
       * height of the screen, so scrolling straight to one would park the turn under
       * the nav bar and the find strip. Both are subtracted, plus a little air.
       */
      const covering = insets.top + layout.chatNavBarHeight + FIND_BAR_HEIGHT + 8;
      scrollRef.current?.scrollTo({ y: Math.max(0, y - covering), animated: true });
    },
    [insets.top],
  );

  /*
   * Typing narrows the results, so the chevrons go back to the first of them.
   *
   * Paired with the write rather than watching for it in an effect: the two are one
   * intent, and an effect would render the old index against the new query first.
   */
  const changeFindQuery = useCallback((next: string) => {
    setFindQuery(next);
    setFindAt(0);
  }, []);

  // Each step, and the first hit of a new query, brings its turn into view.
  useEffect(() => {
    if (findHit) revealHit(findHit.messageId);
  }, [findHit, revealHit]);

  const step = useCallback(
    (by: 1 | -1) => {
      if (findHits.length === 0) return;
      // Wraps both ways: with four hits, "next" from the last is the first again,
      // which is less surprising than a chevron that quietly stops working.
      setFindAt((prev) => {
        const from = Math.min(prev, findHits.length - 1);
        return (from + by + findHits.length) % findHits.length;
      });
    },
    [findHits.length],
  );

  const closeFind = useCallback(() => {
    setFindOpen(false);
    setFindQuery('');
    setFindAt(0);
    Keyboard.dismiss();
  }, []);

  /*
   * The overflow menu's four items, built here because each of them is about this
   * conversation and the menu itself is only a card.
   *
   * Pin and delete are unavailable in temporary mode, and that is not an oversight:
   * a temporary chat has no row to pin and nothing stored to delete -- the toggle in
   * the nav bar is what discards it. So the menu offers what it can actually do.
   */
  const pinned = !!active?.pinned;

  const menuItems: ChatMenuItem[] = useMemo(() => {
    const tap = () => {
      if (hapticsEnabled && Platform.OS !== 'web') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      }
    };

    const items: ChatMenuItem[] = [
      {
        label: 'Share',
        glyph: <Feather name="share" size={18} color={colors.labelPrimary} />,
        onPress: () => {
          tap();
          /*
           * The transcript as text. There is no share link to send -- nothing on the
           * server publishes a conversation -- so this shares the words, which is the
           * thing the user was going to paste anyway.
           */
          const message = toShareText(active?.title ?? '', messages);
          if (message.length === 0) return;
          Share.share({ message }).catch(() => {});
        },
      },
    ];

    if (!temporary && active) {
      items.push({
        label: pinned ? 'Unpin' : 'Pin',
        glyph: (
          <MaterialIcons
            name="push-pin"
            size={18}
            color={colors.labelPrimary}
            style={styles.pinGlyph}
          />
        ),
        onPress: () => {
          tap();
          setPinned(active.id, !pinned);
        },
      });
    }

    items.push({
      label: 'Find in chat',
      glyph: <Feather name="search" size={18} color={colors.labelPrimary} />,
      onPress: () => {
        tap();
        setFindOpen(true);
      },
    });

    if (!temporary && active) {
      items.push({
        label: 'Delete',
        destructive: true,
        glyph: <Feather name="trash-2" size={18} color={palette.danger} />,
        onPress: () => {
          tap();
          /*
           * The one item that asks first. Deleting takes the conversation off the
           * server as well as the device and there is no undo, so it gets the
           * platform's own destructive dialog rather than a silent tap.
           */
          Alert.alert(
            'Delete chat?',
            'This removes it from every device you are signed in on. It cannot be undone.',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: () => {
                  closeFind();
                  deleteConversation(active.id);
                },
              },
            ],
          );
        },
      });
    }

    return items;
  }, [
    active,
    closeFind,
    colors.labelPrimary,
    deleteConversation,
    hapticsEnabled,
    messages,
    pinned,
    setPinned,
    temporary,
  ]);

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
              {
                // The find strip sits over the transcript, so the top pad grows by
                // its height while it is open rather than the strip pushing the list.
                paddingTop:
                  insets.top + layout.chatNavBarHeight + 6 + (findOpen ? FIND_BAR_HEIGHT : 0),
              },
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
              <View key={message.id} onLayout={(event) => onRowLayout(message.id, event)}>
                <MessageRow
                  message={message}
                  /*
                   * Only while the strip is open, and only the trimmed query: passing
                   * a raw one would highlight on the space after a word and re-render
                   * every turn for a keystroke that matched nothing new.
                   */
                  findQuery={findOpen ? findQuery.trim() || undefined : undefined}
                  findActiveStart={
                    findHit && findHit.messageId === message.id ? findHit.start : undefined
                  }
                />
              </View>
            ))}
          </ScrollView>
        )}

        <Animated.View style={[styles.footer, footerStyle]}>
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
            /*
             * False the moment the "x" is tapped, even though the panel itself is
             * still standing until the keyboard is under it: the glyph is the
             * acknowledgement of the tap, and holding the cross for another 250ms
             * reads as the tap not having registered.
             */
            sheetOpen={sheetOpen && !handoff}
            onToggleSheet={() => (sheetOpen ? closeSheet(true) : openSheet())}
            inputRef={inputRef}
            /*
             * Tapping into the field closes the panel without asking for the
             * keyboard back -- the tap is already raising it, and a `focus()` on top
             * of that is what made it flicker.
             */
            onFocusField={() => {
              // The tap is already raising the keyboard, so the inset stays small
              // and the panel collapses over the rise the field just asked for.
              setCollapseMs(undefined);
              setSheetOpen(false);
            }}
            webSearch={webSearch}
            onToggleWebSearch={setWebSearch}
            /*
             * The catalog's label when it has arrived, and the same label derived from
             * the id when it has not.
             *
             * Two sources for one string because they are ready at different times:
             * the stored id comes back from AsyncStorage in milliseconds, the catalog
             * is a network round trip behind it. Deriving locally in the meantime is
             * what stops the chip reading "Model" for a second after launch and then
             * changing under the user -- and since the server derives its label the
             * same way, the two strings are identical, so the swap is invisible.
             *
             * Still null when there is no id at all: a fresh install has not been told
             * which model it uses yet, and the chip says "Model" rather than inventing
             * one.
             */
            modelLabel={
              model ? (models.find((m) => m.id === model)?.label ?? deriveModelLabel(model)) : null
            }
            modelId={model}
            modelsLoaded={modelsLoaded}
            onPressModel={() => setModelSheetOpen(true)}
            attachments={attachments.attachments}
            onRemoveAttachment={attachments.remove}
            dictation={dictation}
          />
        </Animated.View>

        {/*
         * Below the composer, inside the KeyboardAvoidingView: the panel occupies
         * the same layout slot the keyboard's inset does, so the type box does not
         * move as one gives way to the other.
         */}
        <AttachmentSheet
          open={sheetOpen}
          height={keyboardHeight}
          onClose={closeSheet}
          collapseMs={collapseMs}
          onPickPhotos={attachments.pickPhotos}
          onPickFiles={attachments.pickFiles}
        />
      </KeyboardAvoidingView>

      {/*
       * The bar has no fill of its own: the transcript runs the full height of the
       * screen and dissolves into this gradient on its way up, which is what puts
       * the chat under the bar instead of stopping below it.
       */}
      <TopFade />
      <View style={styles.navBarLayer} pointerEvents="box-none">
        <NavBar
          onPressMenu={() => setDrawerOpen(true)}
          onPressEdit={() => router.push('/new')}
          onPressMore={() => setMenuOpen(true)}
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

      <ModelSheet
        visible={modelSheetOpen}
        models={models}
        selected={model}
        loaded={modelsLoaded}
        onSelect={setModel}
        onClose={() => setModelSheetOpen(false)}
        /*
         * The sheet's own refresh button drives this. Not fired on open: the list is
         * read at launch and is almost always current, so re-reading it on every tap
         * of the model chip would spend the proxy's rate limit to confirm nothing
         * changed. Enabling a combo upstream and wanting it now is a deliberate act,
         * so it gets a deliberate control.
         */
        onRefresh={refreshModels}
      />
      <HistoryDrawer
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onOpenSettings={() => router.push('/settings')}
      />

      {/*
       * Over the nav bar's layer, so the popover's own scrim covers the bar it hangs
       * from -- a menu with a live hamburger beside it would let you open the drawer
       * behind it.
       */}
      <ChatMenu visible={menuOpen} onClose={() => setMenuOpen(false)} items={menuItems} />

      {/* Outside the KeyboardAvoidingView, like the nav bar: it is pinned under the
          bar and the transcript is padded out from under it, not shortened by it. */}
      <FindBar
        visible={findOpen}
        query={findQuery}
        onChangeQuery={changeFindQuery}
        index={findIndex}
        total={findHits.length}
        onPrev={() => step(-1)}
        onNext={() => step(1)}
        onClose={closeFind}
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
  // The gap under it is animated (`footerStyle`); this is only the air above, which
  // separates the type box from the last turn's action row.
  footer: { paddingTop: 4 },
  // Leaning the way a pushed pin does, matching the drawer's.
  pinGlyph: { transform: [{ rotate: '45deg' }] },
});
