import type { ApiSource } from '../lib/api';

export type Role = 'user' | 'assistant';

/**
 * What the server is doing with a tool right now, while the reply is still open.
 *
 * Held on the message rather than in one store-level slot: a turn's progress belongs
 * to that turn, so a reply left mid-search by a navigation still shows what it was
 * doing when it is scrolled back to.
 */
export type ToolActivity = {
  phase: 'searching' | 'reading';
  /** The query the model wrote, shown as-is -- it is the most specific thing we have. */
  query: string;
};

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
  /**
   * The tool call in flight. Present only while `pending`, and cleared when the turn
   * finishes -- a finished reply's tool use is described by `sources`, not by this.
   */
  tool?: ToolActivity;
  /**
   * Pages this reply searched and read. Absent on a turn that did not search, which
   * is not the same as an empty array: `[]` would mean a search that found nothing.
   */
  sources?: ApiSource[];
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
