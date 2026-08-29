import React from 'react';
import { Bullets, DocScreen, Prose, Section } from '../src/components/DocScreen';

/**
 * Privacy Policy, reached from Settings > Privacy Policy.
 *
 * Every claim here is one the code backs: the processors named are the ones the
 * server actually calls, and what is described as not stored is not stored. Keep it
 * that way -- a policy that drifts from the implementation is worse than none, and
 * this is the file to update when a dependency changes.
 */

const OPERATOR = '[Operator name]';
const CONTACT_EMAIL = 'support@example.com';
const EFFECTIVE = 'Effective 29 August 2026';

export default function PrivacyScreen() {
  return (
    <DocScreen title="Privacy Policy" subtitle={EFFECTIVE}>
      <Section title="The short version">
        <Prose>
          We keep your email address and your chats, and we send what you write to an AI provider so it
          can be answered. We do not sell anything, and there is no advertising or analytics in the app.
          Temporary chats are not stored at all.
        </Prose>
      </Section>

      <Section title="Who is responsible">
        <Prose>
          {OPERATOR} operates Loom and is the controller of the data described here. Reach us at{' '}
          {CONTACT_EMAIL}.
        </Prose>
      </Section>

      <Section title="What we collect">
        <Bullets
          items={[
            'Your email address, so you can sign in. It is held by our authentication provider, not in our own database.',
            'Your chats: the messages you send, the replies you receive, which model answered, and how many tokens a turn used.',
            'The web pages a reply consulted, when search is on, stored alongside that reply.',
            'A record of the attachments on a turn — the file name and links to the processed copies, plus text extracted from a document. Never the original file.',
            'Your assistant preferences: a display name, tone, verbosity and custom instructions, if you set them.',
            'Your colour scheme, haptics setting, chosen voice and which chats you archived. These stay on your device and are never sent to us.',
          ]}
        />
        <Prose>
          We do not collect your contacts, your location, an advertising identifier, or a device
          fingerprint. There is no analytics SDK and no crash reporter in the app.
        </Prose>
      </Section>

      <Section title="Temporary chats">
        <Prose>
          A temporary chat creates no rows in our database and is not written to your device. It exists in
          memory while the screen is open and is gone when you leave it. The message is still sent to the
          model provider to be answered, under that provider’s own retention.
        </Prose>
      </Section>

      <Section title="Who we share it with">
        <Prose>
          Loom is built on services that do specific jobs. Each one receives only what that job needs.
        </Prose>
        <Bullets
          items={[
            'Authentication: holds your email address and your sign-in sessions, and sends the codes.',
            'Database hosting: stores your chats and preferences.',
            'AI model provider: receives the messages in the conversation you are continuing, your assistant preferences, and any attachment links, in order to generate a reply. It decides how long it keeps a request under its own terms.',
            'Web search and page fetch: receives a search query, and fetches the pages, when you turn search on for a message.',
            'Speech-to-text: receives a voice clip to transcribe. The clip is not stored by us.',
            'Attachment processing: receives a photo or document you attach, re-encodes or renders it, and stores the processed copy on its own storage. The links we keep point there.',
            'Code execution: receives the code from a block you press Run on, and destroys the machine afterwards.',
          ]}
        />
        <Prose>
          These are processors acting on our instructions. We do not sell personal information, and we do
          not share it for advertising or for anyone else’s own purposes.
        </Prose>
      </Section>

      <Section title="Attachments">
        <Prose>
          Files you attach are handled by the processing service and stored on its storage, reachable by
          link. Treat an attachment as leaving the app: do not attach anything you would not want held
          that way. We do not keep the original file on our servers.
        </Prose>
      </Section>

      <Section title="How long we keep it">
        <Prose>
          Your chats stay until you delete them or your account. Deleting a chat removes it and its
          messages from our database immediately and permanently. Archiving does not — it only hides the
          chat on that device.
        </Prose>
        <Prose>
          Deleting your account removes your chats, messages and preferences. Backups and processor logs
          may retain some data for a limited period afterwards.
        </Prose>
      </Section>

      <Section title="Your rights">
        <Prose>
          Depending on where you live you may have the right to access your data, correct it, delete it,
          export it, or object to how it is used. Email {CONTACT_EMAIL} and we will act on it. You can
          delete individual chats yourself at any time from the chat list.
        </Prose>
        <Prose>
          If you are in the UK or EU, our basis for processing is performing the contract in these terms
          (running the app and answering you) and our legitimate interest in keeping the service secure.
        </Prose>
      </Section>

      <Section title="International transfers">
        <Prose>
          Our providers operate in several countries, so your data may be processed outside where you
          live, including in the United States, under appropriate safeguards.
        </Prose>
      </Section>

      <Section title="Children">
        <Prose>
          Loom is not for children under 13, and we do not knowingly collect their data. If you believe a
          child has an account, email us and we will remove it.
        </Prose>
      </Section>

      <Section title="Security">
        <Prose>
          Traffic is encrypted in transit, your session token is held in the device keystore, and our
          server keys never reach the app. No system is perfectly secure, so tell us at {CONTACT_EMAIL} if
          you find a problem.
        </Prose>
      </Section>

      <Section title="Changes">
        <Prose>
          We will update this policy when what the app does changes. The date at the top says when this
          version took effect, and we will give notice in the app before a material change applies.
        </Prose>
      </Section>
    </DocScreen>
  );
}
