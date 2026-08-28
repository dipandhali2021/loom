import type { ApiAttachment, ApiSource } from '../lib/api';

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
  /**
   * Photos and files this question carried, as the upload pipeline returned them.
   * Absent on a plain turn and on every reply -- only a question can attach.
   */
  attachments?: ApiAttachment[];
  createdAt: number;
};

/**
 * A file the composer is holding, before or after it reaches the pipeline.
 *
 * The local `uri` is kept alongside the uploaded result so a chip can show the photo
 * immediately, while it is still going up -- and so a failed upload has something to
 * retry from. Only `remote` is ever sent with a turn.
 */
export type PendingAttachment = {
  /** Local id; the server's own id lives on `remote`. */
  id: string;
  kind: 'image' | 'document';
  name: string;
  mimeType: string;
  size: number;
  /** Where the picker left it on this device. */
  uri: string;
  status: 'uploading' | 'ready' | 'failed';
  /** Why it failed, ready to show under the chip. */
  error?: string;
  /** Set once the pipeline has processed it. */
  remote?: ApiAttachment;
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
  /**
   * Pinned to the top of the history list. Unlike `archived`, this one is a real
   * column on the server, so it follows the account rather than the install.
   */
  pinned: boolean;
};

/**
 * A model id as the proxy names it, e.g. 'qwen-3.7-max-combo'.
 *
 * Deliberately not a union. The list is read from the server at run time
 * (`listModels`), so a model enabled upstream has to be selectable without this
 * file being edited -- which a union would forbid by construction. Kept as an
 * alias rather than removed so the call sites still say what they mean.
 */
export type ModelId = string;

export type VoiceName = 'Breeze' | 'Cove' | 'Sky' | 'Juniper' | 'Ember';
