import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, View } from 'react-native';
import { AppText } from './AppText';
import { Icon } from './Icon';
import { ThinkingIndicator } from './ThinkingIndicator';
import { MessageActions } from './MessageActions';
import { Markdown } from './Markdown';
import { useTheme } from '../theme/ThemeProvider';
import { Message, ToolActivity } from '../store/types';
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
          transform: [
            {
              translateY: enter.interpolate({
                inputRange: [0, 1],
                outputRange: [6, 0],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * What a tool call in flight is called on screen.
 *
 * The query is quoted rather than summarised: it is the model's own words, and it is
 * the difference between "it is doing something" and knowing whether it understood
 * the question -- a search for the wrong thing is visible here seconds before the
 * wrong answer arrives. Long queries are cut rather than wrapped, because this line
 * shares its box with the reply that is about to replace it.
 */
const QUERY_MAX = 42;

function toolLabel(tool: ToolActivity): string {
  const query = tool.query.trim();
  const short =
    query.length > QUERY_MAX ? `${query.slice(0, QUERY_MAX - 1).trimEnd()}\u2026` : query;

  if (tool.phase === 'searching') {
    return short ? `Searching for \u201c${short}\u201d` : 'Searching the web';
  }
  // Reading is the longer of the two waits -- a fetch per page -- so it says so
  // plainly rather than reusing the search's wording and looking stuck.
  return 'Reading the results';
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
  /*
   * Show progress when there is nothing else to show -- but also whenever a tool is
   * open, even under text already written. A pass can emit a sentence and then go
   * looking something up, and on the text-only test that reply would sit there
   * apparently finished for as long as the search took.
   */
  const waiting = streaming && (message.text.length === 0 || !!message.tool);

  if (isUser) {
    const attachments = message.attachments ?? [];
    return (
      <FadeIn style={styles.userRow}>
        {/*
         * Above the capsule, not inside it: a photo has no business inheriting the
         * bubble's padding, and the transcript should show what was sent as plainly
         * as the composer showed it going out. The first pipeline URL is the image
         * the model was given, so this is literally what it saw.
         */}
        {attachments.length > 0 ? (
          <View style={styles.attachments}>
            {attachments.map((item) =>
              item.kind === 'image' && item.images.length > 0 ? (
                <Image
                  key={item.id}
                  source={{ uri: item.images[0] }}
                  style={[styles.attachThumb, { backgroundColor: colors.fillQuaternary }]}
                  resizeMode="cover"
                  accessibilityLabel={item.name}
                />
              ) : (
                // A document is its name: the page render says nothing a filename
                // does not say better, and the name is what the reply refers to.
                <View
                  key={item.id}
                  style={[styles.attachFile, { backgroundColor: colors.fillQuaternary }]}
                >
                  <Icon name="file-02" size={16} color={colors.labelSecondary} />
                  <AppText variant="footnote" tone="secondary" numberOfLines={1}>
                    {item.name}
                  </AppText>
                </View>
              ),
            )}
          </View>
        ) : null}

        {message.text.length > 0 ? (
          <View
            style={[
              styles.bubble,
              {
                backgroundColor: colors.bubbleUser,
                borderColor: colors.bubbleUserBorder,
              },
            ]}
          >
            {/* The capsule is a light surface in both schemes, so its label takes
              its own colour rather than the page's primary label. */}
            <AppText
              variant="chatBubble"
              tone="none"
              style={{ color: colors.bubbleUserText }}
              selectable
            >
              {message.text}
            </AppText>
          </View>
        ) : null}
      </FadeIn>
    );
  }

  return (
    <View style={styles.assistantRow}>
      {/* Markdown rather than raw text: a reply is full of `##` and `**`, and
          showing those as characters is what made it look unformatted. Each
          part the reveal hands over fades in inside here. */}
      {message.text.length > 0 ? (
        <Markdown
          text={message.text}
          revealFrom={message.revealFrom}
          /*
           * Held back while it streams: the list grows as pages are read, and a
           * link becoming a pill mid-sentence would re-wrap the paragraph the user
           * is in the middle of. Once the turn is done every citation resolves at
           * once, and the layout settles for good.
           */
          sources={streaming ? undefined : message.sources}
        />
      ) : null}

      {/* Under the text, not instead of it: the tool call is the newest thing that
          happened, so it belongs where the next tokens will appear. */}
      {waiting ? (
        <View style={[styles.waitWrap, message.text.length > 0 ? styles.waitAfterText : null]}>
          <ThinkingIndicator label={message.tool ? toolLabel(message.tool) : undefined} />
        </View>
      ) : null}

      {/* A turn that failed says so in place, rather than leaving a blank row. */}
      {message.error ? (
        <AppText tone="none" style={[type.footnote, styles.error, { color: palette.danger }]}>
          {message.error}
        </AppText>
      ) : null}

      {/* The action row only appears once the reply has finished landing. The
          sources live inside it rather than in a block of their own: the pills in
          the prose already say which sentence came from where, so all that is left
          is a way to the full list. */}
      {!streaming && message.text.length > 0 ? (
        <FadeIn>
          <MessageActions messageId={message.id} text={message.text} sources={message.sources} />
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
  // Right-aligned with the capsule, wrapping onto a second row past three or four.
  attachments: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 6,
    maxWidth: '78%',
    marginBottom: 6,
  },
  attachThumb: { width: 88, height: 88, borderRadius: 12 },
  attachFile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: 220,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
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
  // Only when it follows text, so the indicator alone still sits flush with the top
  // of the row where the first line of the reply will land.
  waitAfterText: { marginTop: 6 },
  error: { marginTop: 4 },
});
