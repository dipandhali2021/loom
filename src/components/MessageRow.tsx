import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { AppText } from './AppText';
import { Icon } from './Icon';
import { MessageActions } from './MessageActions';
import { Markdown } from './Markdown';
import { useTheme } from '../theme/ThemeProvider';
import { Message } from '../store/types';
import { layout, palette, type } from '../theme/tokens';

/** One beat of the thinking indicator's cycle, per dot. */
const DOT_DURATION = 420;
const DOT_STAGGER = 140;

/**
 * Shown from the moment a turn is sent until the first token lands, so the wait
 * for the model to start is never a blank row. The kit draws a single dot; three
 * staggered ones read as "working" rather than "finished with nothing to say",
 * which is what a lone static dot looks like on a slow first token.
 */
function ThinkingDots() {
  const dots = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;

  useEffect(() => {
    const animations = dots.map((dot, index) =>
      Animated.loop(
        Animated.sequence([
          // The offset is what staggers the three; without it they pulse in unison.
          Animated.delay(index * DOT_STAGGER),
          Animated.timing(dot, {
            toValue: 1,
            duration: DOT_DURATION,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(dot, {
            toValue: 0,
            duration: DOT_DURATION,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          // Pads the cycle so the stagger does not collapse on the next pass.
          Animated.delay((dots.length - 1 - index) * DOT_STAGGER),
        ])
      )
    );
    animations.forEach((animation) => animation.start());
    return () => animations.forEach((animation) => animation.stop());
  }, [dots]);

  return (
    <View style={styles.dots} accessibilityRole="progressbar" accessibilityLabel="Generating a reply">
      {dots.map((dot, index) => (
        <Animated.View
          key={index}
          style={{
            opacity: dot.interpolate({ inputRange: [0, 1], outputRange: [0.28, 1] }),
            transform: [{ scale: dot.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1] }) }],
          }}
        >
          <Icon name="loading-dot" size={7} />
        </Animated.View>
      ))}
    </View>
  );
}

/** Fades its children in once, so a turn arrives rather than snapping in. */
function FadeIn({ children, style }: { children: React.ReactNode; style?: object }) {
  const enter = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [enter]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: enter,
          transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * One turn in the transcript, in the ChatGPT Apps UI Kit's shape: the user's
 * message is a right-aligned white capsule with dark text, the assistant's is
 * plain body text running the full width with an action row beneath it. Neither
 * side carries an avatar or a "You" / "ChatGPT" label any more — dropping them is
 * most of what removes the old layout's whitespace.
 */
function MessageRowBase({ message }: { message: Message }) {
  const { colors } = useTheme();
  const isUser = message.role === 'user';
  const streaming = !isUser && !!message.pending;
  // Nothing has arrived yet: the request is out but the model has not started.
  const waiting = streaming && message.text.length === 0;

  if (isUser) {
    return (
      <FadeIn style={styles.userRow}>
        <View
          style={[
            styles.bubble,
            { backgroundColor: colors.bubbleUser, borderColor: colors.bubbleUserBorder },
          ]}
        >
          {/* The capsule is a light surface in both schemes, so its label takes
              its own colour rather than the page's primary label. */}
          <AppText variant="chatBubble" tone="none" style={{ color: colors.bubbleUserText }} selectable>
            {message.text}
          </AppText>
        </View>
      </FadeIn>
    );
  }

  return (
    <View style={styles.assistantRow}>
      {waiting ? (
        <View style={styles.dotWrap}>
          <ThinkingDots />
        </View>
      ) : message.text.length > 0 ? (
        /* Markdown rather than raw text: a reply is full of `##` and `**`, and
           showing those as characters is what made it look unformatted. Each
           part the reveal hands over fades in inside here. */
        <Markdown text={message.text} revealFrom={message.revealFrom} />
      ) : null}

      {/* A turn that failed says so in place, rather than leaving a blank row. */}
      {message.error ? (
        <AppText tone="none" style={[type.footnote, styles.error, { color: palette.danger }]}>
          {message.error}
        </AppText>
      ) : null}

      {/* The action row only appears once the reply has finished landing. */}
      {!streaming && message.text.length > 0 ? (
        <FadeIn>
          <MessageActions messageId={message.id} text={message.text} />
        </FadeIn>
      ) : null}
    </View>
  );
}

/*
 * Memoized because the streaming reveal writes a new text slice for every part it
 * hands over. Only the message being written gets a new object -- every other row
 * keeps its identity through `patchMessage`, so this is what keeps a long
 * transcript from re-rendering in full several times a second.
 */
export const MessageRow = React.memo(MessageRowBase);

const styles = StyleSheet.create({
  userRow: {
    alignItems: 'flex-end',
    paddingHorizontal: layout.chatPadding,
    paddingTop: layout.turnGap,
  },
  bubble: {
    // The kit caps the capsule at ~78% of the frame so long turns still wrap.
    maxWidth: '78%',
    borderRadius: layout.bubbleRadius,
    // The fill draws the capsule now; the border only shows in light mode, where
    // it separates a near-white bubble from a white page.
    borderWidth: 1,
    paddingHorizontal: layout.bubblePaddingH,
    paddingVertical: layout.bubblePaddingV,
  },
  assistantRow: {
    paddingHorizontal: layout.chatPadding,
    paddingTop: layout.turnGap,
  },
  dotWrap: { height: 25, justifyContent: 'center' },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  error: { marginTop: 4 },
});
