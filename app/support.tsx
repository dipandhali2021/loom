import React from 'react';
import { Linking, Pressable, StyleSheet } from 'react-native';
import { AppText } from '../src/components/AppText';
import { Bullets, DocScreen, Prose, Section } from '../src/components/DocScreen';
import { type } from '../src/theme/tokens';

/**
 * Help Center, reached from Settings > Help Center.
 *
 * Written against what the app actually does, not around it: every answer here is
 * checkable in the code, and a feature that is a placeholder says so. A help page
 * that describes an app more capable than the one installed costs more support mail
 * than it saves.
 */

const SUPPORT_EMAIL = 'support@example.com';

export default function SupportScreen() {
  return (
    <DocScreen title="Help Center">
      <Section title="Signing in">
        <Prose>
          Loom signs you in with a six-digit code sent to your email address. There is no password to
          forget: enter your address, and whether the account already exists or not, the next screen is
          the code. Codes expire, so request a new one if the old one stops working. If the code does
          not arrive, check the spam folder before requesting another — asking repeatedly can trip the
          rate limit and slow things down.
        </Prose>
        <Prose>
          You can also continue with Google, which uses your device&rsquo;s own account picker rather than
          opening a browser. If the Google button is greyed out, this build was not set up for it &mdash; use
          email instead. The Apple button is not connected yet.
        </Prose>
      </Section>

      <Section title="Chats">
        <Prose>
          A reply streams in as it is written. The round button in the composer becomes a stop button
          while it does, and stopping keeps whatever had already arrived.
        </Prose>
        <Bullets
          items={[
            'Pin a chat from the overflow menu to hold it at the top of the list. Pins follow your account to other devices.',
            'Archiving hides a chat from the list on this device. It stays on the server and is not shared with your other devices.',
            'Deleting a chat removes it and its messages from the server. It cannot be undone.',
            'Share copies the conversation as plain text, not as a link. Nothing is published.',
          ]}
        />
      </Section>

      <Section title="Temporary chats">
        <Prose>
          A temporary chat is never written down. It is not saved on this device, no rows are created on
          the server, and it disappears when you leave the screen — so it also will not appear in your
          history later. Your message is still sent to the model provider to be answered.
        </Prose>
      </Section>

      <Section title="Choosing a model">
        <Prose>
          The model picker lives in the composer, beside the field it applies to. The list comes from
          the server rather than being built into the app, so a newly enabled model appears without an
          update. Opening the picker refreshes it.
        </Prose>
        <Prose>
          The model is a property of the message you are writing. Changing it affects the next message,
          not the ones already in the chat.
        </Prose>
      </Section>

      <Section title="Web search">
        <Prose>
          With search on, a reply may look things up before answering, and the pages it read are listed
          under the reply. Search is off by default and set per message. It is a live web request, so
          the query leaves the app.
        </Prose>
      </Section>

      <Section title="Attachments">
        <Prose>
          Attach a photo from your library, take one with the camera, or attach a document. Images are
          re-encoded and documents have their first pages rendered and their text extracted, then the
          result is passed to the model.
        </Prose>
        <Prose>
          Attachment processing runs on a third-party pipeline, and the processed files are stored there
          rather than on our own servers. Do not attach anything you would not want handled that way.
        </Prose>
      </Section>

      <Section title="Running code">
        <Prose>
          A code block in a language we support gets a Run button. The code executes in a throwaway
          virtual machine that is destroyed afterwards, and you see stdout, stderr, the exit code and
          how long it took. It has no access to your device or your files.
        </Prose>
        <Prose>
          This depends on server configuration. Where it has not been set up, the Run button does not
          appear.
        </Prose>
      </Section>

      <Section title="Voice">
        <Prose>
          The mic in the composer records a clip and transcribes it into the field, where you can edit
          it before sending. The clip is not stored — it is held only for the length of the request.
        </Prose>
        <Prose>
          Voice mode, reached from the round button, is a preview. It animates but does not yet hold a
          spoken conversation.
        </Prose>
      </Section>

      <Section title="Appearance and haptics">
        <Prose>
          Settings has Light, Dark and System for the colour scheme, and a switch for haptic feedback.
          Both are stored on this device only.
        </Prose>
      </Section>

      <Section title="Known limits">
        <Bullets
          items={[
            'Apple sign-in is a placeholder. Google and email both work.',
            'Voice mode does not hold a conversation yet.',
            'Subscription, Restore purchases, Data Controls, Custom instructions and Main Language are not wired up.',
            'Thumbs up and down on a reply are not sent anywhere.',
            'A reply that was mid-stream when the app closed does not resume.',
          ]}
        />
      </Section>

      <Section title="Getting in touch">
        <Prose>
          If something is broken, or you want your account and its data deleted, email us. Say which
          device and OS version you are on and roughly when it happened — that is usually enough to
          find it.
        </Prose>
        <Pressable
          onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}
          accessibilityRole="link"
          accessibilityLabel={`Email ${SUPPORT_EMAIL}`}
          style={({ pressed }) => [styles.mailRow, { opacity: pressed ? 0.6 : 1 }]}
        >
          <AppText tone="primary" style={[type.message, styles.link]}>
            {SUPPORT_EMAIL}
          </AppText>
        </Pressable>
      </Section>
    </DocScreen>
  );
}

const styles = StyleSheet.create({
  mailRow: { alignSelf: 'flex-start' },
  link: { textDecorationLine: 'underline' },
});
