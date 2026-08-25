export type Role = 'user' | 'assistant';

export type Message = {
  id: string;
  /**
   * The row id on the server. Assigned when the turn is stored, so it is absent
   * on an optimistic message that has not been acknowledged yet -- and a reply
   * cannot be regenerated until it has one.
   */
  remoteId?: string;
  role: Role;
  text: string;
  /**
   * Offset in `text` where the most recently revealed part begins, so the view can
   * fade in just that span. Set by the reveal while a reply streams; absent on a
   * message that was never streamed (history, or the user's own turn).
   */
  revealFrom?: number;
  /** True while the assistant reply is still streaming in. */
  pending?: boolean;
  /** Set when the turn failed, so the row can show what went wrong. */
  error?: string;
  createdAt: number;
};

export type Conversation = {
  id: string;
  /**
   * The row id on the server, once one exists. Absent until the first message is
   * sent: an empty chat the user never typed into is not worth a round trip, and
   * `id` stays local so the UI can open it before the server has heard of it.
   */
  remoteId?: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  archived: boolean;
};

/** 'gpt-5' is the default the Apps UI Kit's nav bar shows; the older two stay selectable. */
export type ModelId = 'gpt-3.5' | 'gpt-4' | 'gpt-5';

export type VoiceName = 'Breeze' | 'Cove' | 'Sky' | 'Juniper' | 'Ember';
