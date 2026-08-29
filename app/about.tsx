import React from 'react';
import Constants from 'expo-constants';
import { Bullets, DocScreen, Prose, Section } from '../src/components/DocScreen';

/** About, reached from Settings. */
export default function AboutScreen() {
  const version = Constants.expoConfig?.version ?? '1.0.0';

  return (
    <DocScreen title="About" subtitle={`Version ${version}`}>
      <Section title="Loom">
        <Prose>
          Loom is a chat app for talking to AI models. A conversation is a thread: you write, a reply
          streams back, and the thread is kept so you can pick it up later. The name is the rest of the
          idea — many threads, one cloth.
        </Prose>
      </Section>

      <Section title="What it does">
        <Bullets
          items={[
            'Streaming replies, with the reply’s own stop button while it arrives.',
            'Any model the server offers, chosen per message in the composer.',
            'Web search on demand, with the pages a reply read listed under it.',
            'Photos and documents as attachments.',
            'Code blocks you can run in a disposable sandbox.',
            'Dictation from the composer’s mic.',
            'Temporary chats that are never stored.',
            'Light, dark and system appearance.',
          ]}
        />
      </Section>

      <Section title="Built with">
        <Prose>
          React Native and Expo on the client, with an Express and Postgres server in front of the model
          provider. The server exists so that no API key is ever in the app.
        </Prose>
      </Section>

      <Section title="Replies are generated">
        <Prose>
          Model output can be wrong, and is not professional advice. Check anything you plan to act on.
          The Help Center lists what is finished and what is not.
        </Prose>
      </Section>
    </DocScreen>
  );
}
