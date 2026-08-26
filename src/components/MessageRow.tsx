import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { AppText } from './AppText';
import { ThinkingIndicator } from './ThinkingIndicator';
import { MessageActions } from './MessageActions';
import { Markdown } from './Markdown';
import { useTheme } from '../theme/ThemeProvider';
import { Message } from '../store/types';
import { layout, palette, type } from '../theme/tokens';

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
        <View style={styles.waitWrap}>
          <ThinkingIndicator />
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
  // One line of chat body, so the indicator occupies exactly the room the first
  // line of the reply will, and nothing shifts when it is replaced by text.
  waitWrap: { minHeight: 25, justifyContent: 'center' },
  error: { marginTop: 4 },
});
