import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@clerk/expo';
import { Conversation, Message, ModelId, VoiceName } from './types';
import { createId } from '../lib/id';
import { deriveTitle } from '../lib/title';
import {
  AbortedError,
  createConversation,
  deleteConversation as deleteRemote,
  getConversation,
  listConversations,
  streamCompletion,
  type ApiConversation,
  type GetToken,
} from '../lib/api';
import { useEmailOtpAuth } from '../auth/useEmailOtpAuth';
import { createReveal } from '../lib/reveal';

/*
 * Bumped from v1: `signedIn` / `emailVerified` / `email` used to be persisted here.
 * Clerk owns the session now, and the hydrate below spreads whatever it reads over
 * the defaults -- so a v1 payload would reinstate a stale "signed in" that no Clerk
 * session backs. A new key retires those records instead of migrating them.
 */
const STORAGE_KEY = 'chatgpt-clone/state-v2';

type PersistedState = {
  conversations: Conversation[];
  activeId: string | null;
  model: ModelId;
  voice: VoiceName;
  hapticsEnabled: boolean;
};

type ChatStoreValue = PersistedState & {
  /** Storage has been read *and* Clerk has loaded; until then the launch screen shows. */
  hydrated: boolean;
  /**
   * Past the login screen: either a live session, or an outstanding email code.
   * The (auth) stack pairs this with `emailVerified` to pick login vs verify-email.
   */
  signedIn: boolean;
  /** A live Clerk session exists. Only true once a code has been verified. */
  emailVerified: boolean;
  /** Signed-in user's primary address, or the address a pending code went to. */
  email: string | null;
  active: Conversation | null;
  /** Conversations shown in the drawer (archived ones excluded). */
  visibleConversations: Conversation[];
  archivedConversations: Conversation[];
  isStreaming: boolean;
  newConversation: () => string;
  openConversation: (id: string) => void;
  sendMessage: (text: string) => void;
  /** Re-runs the reply for an assistant turn, driving the action row's refresh button. */
  regenerate: (messageId: string) => void;
  stopStreaming: () => void;
  deleteConversation: (id: string) => void;
  setArchived: (id: string, archived: boolean) => void;
  setModel: (model: ModelId) => void;
  setVoice: (voice: VoiceName) => void;
  setHapticsEnabled: (enabled: boolean) => void;
  /**
   * The Clerk session token, for callers that talk to the API on their own.
   *
   * Exposed here so `useAuth` stays imported in exactly two places -- this file and
   * the sign-in flow -- rather than spreading through the component tree. The code
   * block's Run button is the caller: its request is per-block and short-lived, with
   * nothing for this store to hold.
   */
  authToken: GetToken;
  /** Ends the Clerk session, or abandons an unverified attempt, and clears local chat state. */
  signOut: () => void;
};

const initialState: PersistedState = {
  conversations: [],
  activeId: null,
  model: 'gpt-5',
  voice: 'Juniper',
  hapticsEnabled: true,
};

const ChatContext = createContext<ChatStoreValue | null>(null);

export function ChatStoreProvider({ children }: { children: React.ReactNode }) {
  /*
   * Clerk is the only source of truth for who is signed in; none of it is
   * persisted here. `pendingVerification` covers the gap that `email_code`
   * creates -- between requesting a code and verifying it there is no session
   * yet, so `isSignedIn` is false even though the user is past the login screen.
   */
  const { isLoaded: clerkLoaded, isSignedIn, signOut: clerkSignOut, getToken } = useAuth();
  const { pendingVerification, pendingEmail, resetFlow } = useEmailOtpAuth();

  const [state, setState] = useState<PersistedState>(initialState);
  const [storageHydrated, setStorageHydrated] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  /** Aborts the in-flight turn: the Stop button, a new send, or an unmount. */
  const streamAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<PersistedState>;
          setState((prev) => ({
            ...prev,
            ...parsed,
            // A reply that was mid-stream when the app closed is not resumable. Its
            // reveal boundary goes with it -- kept, the tail of a message would fade
            // in again on every app open, as if it were still arriving.
            conversations: (parsed.conversations ?? []).map((c) => ({
              ...c,
              messages: c.messages
                .filter((m) => !m.pending || m.text.length > 0)
                .map((m) => ({ ...m, pending: false, revealFrom: undefined })),
            })),
          }));
        }
      })
      .catch(() => {
        // Corrupt or unreadable storage: start from a clean slate.
      })
      .finally(() => setStorageHydrated(true));
  }, []);

  useEffect(() => {
    if (!storageHydrated) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {});
  }, [state, storageHydrated]);

  const clearTimer = useCallback(() => {
    streamAbort.current?.abort();
    streamAbort.current = null;
    setIsStreaming(false);
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  /*
   * Clerk's `getToken` identity changes between renders, so reading it through a
   * ref keeps `sendMessage` from being rebuilt on every one -- it is a dependency
   * of half the callbacks below, and each rebuild would remount the composer.
   */
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;
  const token = useCallback(() => getTokenRef.current(), []);

  /*
   * A read-only view of the latest state for async code. `sendMessage` needs the
   * active conversation's `remoteId` *after* an await, where a value captured in
   * the closure would already be stale.
   */
  const stateRef = useRef(state);
  stateRef.current = state;

  /*
   * Pull the conversation list once per sign-in. Local state is the working copy --
   * this only adds rows the device has not seen (another device, or a reinstall),
   * matched on `remoteId` so nothing is duplicated.
   */
  const synced = useRef(false);
  useEffect(() => {
    if (!storageHydrated || !isSignedIn || synced.current) return;
    synced.current = true;

    void listConversations(token)
      .then((summaries) => {
        setState((prev) => {
          const known = new Set(prev.conversations.map((c) => c.remoteId).filter(Boolean));
          const missing = summaries
            .filter((s) => !known.has(s.id))
            .map<Conversation>((s) => ({
              id: s.id,
              remoteId: s.id,
              title: s.title || 'New chat',
              // Messages arrive when the conversation is opened.
              messages: [],
              createdAt: s.createdAt,
              updatedAt: s.updatedAt,
              archived: false,
            }));
          if (missing.length === 0) return prev;

          return {
            ...prev,
            conversations: [...prev.conversations, ...missing].sort((a, b) => b.updatedAt - a.updatedAt),
          };
        });
      })
      .catch((error) => {
        console.warn('[chat] could not load the conversation list', error);
        // Let a later sign-in try again rather than leaving this wedged.
        synced.current = false;
      });
  }, [isSignedIn, storageHydrated, token]);

  // Signing out has to re-arm the sync, or the next account gets no list at all.
  useEffect(() => {
    if (!isSignedIn) synced.current = false;
  }, [isSignedIn]);

  const patchConversation = useCallback((id: string, fn: (c: Conversation) => Conversation) => {
    setState((prev) => ({
      ...prev,
      conversations: prev.conversations.map((c) => (c.id === id ? fn(c) : c)),
    }));
  }, []);

  const newConversation = useCallback(() => {
    const id = createId('conv');
    const now = Date.now();
    clearTimer();
    setState((prev) => ({
      ...prev,
      activeId: id,
      conversations: [
        { id, title: 'New chat', messages: [], createdAt: now, updatedAt: now, archived: false },
        ...prev.conversations,
      ],
    }));
    return id;
  }, [clearTimer]);

  /** Server payload -> the app's shape. Server ids are kept as `remoteId`. */
  const fromApi = useCallback(
    (remote: ApiConversation): Conversation => ({
      id: remote.id,
      remoteId: remote.id,
      title: remote.title || 'New chat',
      messages: remote.messages.map((m) => ({
        id: m.id,
        remoteId: m.id,
        role: m.role,
        text: m.text,
        // A reply still marked pending server-side was cut off, not still running.
        createdAt: m.createdAt,
      })),
      createdAt: remote.createdAt,
      updatedAt: remote.updatedAt,
      archived: false,
    }),
    []
  );

  const openConversation = useCallback(
    (id: string) => {
      clearTimer();
      setState((prev) => ({ ...prev, activeId: id }));

      /*
       * Fill in a conversation that came from the list endpoint (summaries carry no
       * messages). Skipped once it holds messages, so re-opening a chat does not
       * refetch, and never for a purely local one.
       */
      const local = stateRef.current.conversations.find((c) => c.id === id);
      if (!local?.remoteId || local.messages.length > 0) return;

      void getConversation(token, local.remoteId)
        .then((remote) => {
          patchConversation(id, (c) =>
            // Guard against a send having landed while the fetch was in flight.
            c.messages.length > 0 ? c : { ...c, ...fromApi(remote), id: c.id },
          );
        })
        .catch((error) => {
          console.warn('[chat] could not load the conversation', error);
        });
    },
    [clearTimer, fromApi, patchConversation, token]
  );

  /** Rewrites one message in one conversation. The unit every stream update uses. */
  const patchMessage = useCallback(
    (conversationId: string, messageId: string, fn: (m: Message) => Message) =>
      patchConversation(conversationId, (c) => ({
        ...c,
        updatedAt: Date.now(),
        messages: c.messages.map((m) => (m.id === messageId ? fn(m) : m)),
      })),
    [patchConversation]
  );

  /**
   * Streams one reply from the API into `replyId`. Shared by send and regenerate,
   * which differ only in whether the server appends a turn or rewrites one.
   */
  const runStream = useCallback(
    async (args: {
      conversationId: string;
      remoteConversationId: string;
      replyId: string;
      /** The optimistic user row, so the server's id can be attached to it. */
      userMessageId?: string;
      prompt: string;
      model: ModelId;
      regenerateRemoteId?: string;
    }) => {
      const { conversationId, remoteConversationId, replyId, prompt, model } = args;

      const controller = new AbortController();
      streamAbort.current = controller;
      setIsStreaming(true);

      /*
       * Received text and displayed text are separate. Deltas arrive in bursts --
       * and when the response body is buffered before we read it, they all arrive
       * in the same tick -- so writing them straight to state renders the reply as
       * one block. `createReveal` hands over a part at a time on animation frames
       * instead, and reports where each part starts so the row can fade in just
       * that span. See src/lib/reveal.ts.
       */
      let text = '';
      // Where the last part started, so finishing the turn can leave it fading
      // rather than snapping it to full strength.
      let revealedFrom = 0;
      const reveal = createReveal(
        (visible, from) => {
          revealedFrom = from;
          patchMessage(conversationId, replyId, (m) => ({
            ...m,
            text: visible,
            revealFrom: from,
            pending: true,
          }));
        },
        controller.signal,
      );

      try {
        for await (const event of streamCompletion({
          getToken: token,
          conversationId: remoteConversationId,
          text: prompt,
          model,
          ...(args.regenerateRemoteId ? { regenerateMessageId: args.regenerateRemoteId } : {}),
          signal: controller.signal,
        })) {
          switch (event.type) {
            case 'user':
              // Adopt the server's id for the question the app posted optimistically.
              if (args.userMessageId) {
                patchMessage(conversationId, args.userMessageId, (m) => ({
                  ...m,
                  remoteId: event.message.id,
                }));
              }
              break;
            case 'assistant':
              patchMessage(conversationId, replyId, (m) => ({ ...m, remoteId: event.id }));
              break;
            case 'delta':
              text += event.text;
              reveal.push(text);
              break;
            case 'done':
              /*
               * The server's copy is authoritative, but the tail of it may not be
               * on screen yet -- so let the reveal drain before the turn is marked
               * finished, or the last words would appear all at once and the action
               * row would pop in over text still being typed.
               */
              text = event.message.text;
              reveal.push(text);
              await reveal.finish();
              patchMessage(conversationId, replyId, (m) => ({
                ...m,
                remoteId: event.message.id,
                text: event.message.text,
                /*
                 * The final part is very likely still fading, so its boundary is
                 * kept -- overwriting it with the end of the text would drop the
                 * animating span and snap the last words in. If the server's copy
                 * differs from what was revealed there is nothing to preserve.
                 */
                revealFrom: event.message.text === reveal.visible() ? revealedFrom : event.message.text.length,
                pending: false,
                error: undefined,
              }));
              break;
            case 'error':
              // Whatever arrived stays, but stop pacing: the error is the news now.
              reveal.settle();
              patchMessage(conversationId, replyId, (m) => ({
                ...m,
                text,
                pending: false,
                error: event.message,
              }));
              break;
          }
        }
      } catch (error) {
        /*
         * Stop was pressed: keep the partial text as the reply. It is already
         * stored server-side as incomplete, so this matches what a reload shows.
         */
        if (error instanceof AbortedError || controller.signal.aborted) {
          reveal.settle();
          patchMessage(conversationId, replyId, (m) => ({ ...m, text, pending: false }));
        } else {
          reveal.settle();
          patchMessage(conversationId, replyId, (m) => ({
            ...m,
            text,
            pending: false,
            error: error instanceof Error ? error.message : 'Something went wrong.',
          }));
        }
      } finally {
        // A frame loop left running would keep writing into a finished turn.
        reveal.cancel();
        if (streamAbort.current === controller) {
          streamAbort.current = null;
          setIsStreaming(false);
        }
      }
    },
    [patchMessage, token]
  );

  /**
   * The server id for a local conversation, creating the row on first use.
   *
   * Conversations start local so a new chat opens with no network wait; the row is
   * created the first time a message actually needs somewhere to live.
   */
  const ensureRemoteConversation = useCallback(
    async (conversationId: string, title: string): Promise<string> => {
      const existing = stateRef.current.conversations.find((c) => c.id === conversationId)?.remoteId;
      if (existing) return existing;

      const remote = await createConversation(token, title);
      patchConversation(conversationId, (c) => ({ ...c, remoteId: remote.id }));
      return remote.id;
    },
    [patchConversation, token]
  );

  const sendMessage = useCallback(
    (rawText: string) => {
      const text = rawText.trim();
      if (!text) return;
      clearTimer();

      const now = Date.now();
      const userMessage: Message = { id: createId('msg'), role: 'user', text, createdAt: now };
      const replyId = createId('msg');
      const assistantMessage: Message = {
        id: replyId,
        role: 'assistant',
        text: '',
        pending: true,
        createdAt: now + 1,
      };

      // Both turns render immediately; the request follows. Typing should never
      // wait on a round trip, and the pending reply is what shows the dot.
      let targetId = state.activeId;
      let title = deriveTitle(text);
      setState((prev) => {
        let conversations = prev.conversations;
        let activeId = prev.activeId;

        if (!activeId || !conversations.some((c) => c.id === activeId)) {
          activeId = createId('conv');
          conversations = [
            { id: activeId, title: 'New chat', messages: [], createdAt: now, updatedAt: now, archived: false },
            ...conversations,
          ];
        }
        targetId = activeId;

        return {
          ...prev,
          activeId,
          conversations: conversations.map((c) => {
            if (c.id !== activeId) return c;
            const first = c.messages.length === 0;
            title = first ? deriveTitle(text) : c.title;
            return {
              ...c,
              title,
              messages: [...c.messages, userMessage, assistantMessage],
              updatedAt: now,
            };
          }),
        };
      });

      const conversationId = targetId;
      if (!conversationId) return;

      void (async () => {
        try {
          const remoteConversationId = await ensureRemoteConversation(conversationId, title);
          await runStream({
            conversationId,
            remoteConversationId,
            replyId,
            userMessageId: userMessage.id,
            prompt: text,
            model: state.model,
          });
        } catch (error) {
          // Creating the conversation failed, so the stream never started.
          patchMessage(conversationId, replyId, (m) => ({
            ...m,
            pending: false,
            error: error instanceof Error ? error.message : 'Something went wrong.',
          }));
          setIsStreaming(false);
        }
      })();
    },
    [clearTimer, ensureRemoteConversation, patchMessage, runStream, state.activeId, state.model]
  );

  const regenerate = useCallback(
    (messageId: string) => {
      clearTimer();
      const conversation = state.conversations.find((c) => c.messages.some((m) => m.id === messageId));
      if (!conversation) return;

      const index = conversation.messages.findIndex((m) => m.id === messageId);
      const target = conversation.messages[index];
      if (!target || target.role !== 'assistant') return;

      // Re-answer the user turn this reply belongs to.
      const prompt = [...conversation.messages.slice(0, index)].reverse().find((m) => m.role === 'user')?.text;
      if (!prompt) return;

      /*
       * Both ids have to exist server-side: without them there is nothing to
       * rewrite, and re-posting the question would duplicate the turn. This is
       * only reachable for a reply that failed before it was ever stored.
       */
      const remoteConversationId = conversation.remoteId;
      const remoteMessageId = target.remoteId;
      if (!remoteConversationId || !remoteMessageId) {
        patchMessage(conversation.id, messageId, (m) => ({
          ...m,
          error: 'This reply was never saved. Send the message again.',
        }));
        return;
      }

      patchMessage(conversation.id, messageId, (m) => ({
        ...m,
        text: '',
        revealFrom: 0,
        pending: true,
        error: undefined,
      }));

      /*
       * The server drops everything after the reply it rewrites, so the local copy
       * has to match -- otherwise turns would linger under an answer that no longer
       * produced them.
       */
      patchConversation(conversation.id, (c) => ({
        ...c,
        messages: c.messages.slice(0, index + 1),
      }));

      void runStream({
        conversationId: conversation.id,
        remoteConversationId,
        replyId: messageId,
        prompt,
        model: state.model,
        regenerateRemoteId: remoteMessageId,
      });
    },
    [clearTimer, patchConversation, patchMessage, runStream, state.conversations, state.model]
  );

  const stopStreaming = useCallback(() => {
    clearTimer();
    setState((prev) => ({
      ...prev,
      conversations: prev.conversations.map((c) => ({
        ...c,
        messages: c.messages.map((m) => (m.pending ? { ...m, pending: false } : m)),
      })),
    }));
  }, [clearTimer]);

  const deleteConversation = useCallback(
    (id: string) => {
      clearTimer();

      /*
       * Fire-and-forget, and read before the local removal: the row is gone from
       * the UI either way, and a failed delete is not something to make the user
       * retry from a list that no longer shows the item.
       */
      const remoteId = stateRef.current.conversations.find((c) => c.id === id)?.remoteId;
      if (remoteId) {
        deleteRemote(token, remoteId).catch((error) => {
          console.warn('[chat] could not delete the conversation on the server', error);
        });
      }

      setState((prev) => {
        const conversations = prev.conversations.filter((c) => c.id !== id);
        return {
          ...prev,
          conversations,
          activeId: prev.activeId === id ? (conversations[0]?.id ?? null) : prev.activeId,
        };
      });
    },
    [clearTimer, token]
  );

  const setArchived = useCallback(
    (id: string, archived: boolean) => patchConversation(id, (c) => ({ ...c, archived })),
    [patchConversation]
  );

  const value = useMemo<ChatStoreValue>(() => {
    const active = state.conversations.find((c) => c.id === state.activeId) ?? null;
    return {
      ...state,
      // Both have to settle: storage decides which chats exist, Clerk decides
      // which stack renders. Reporting early would flash the login screen at a
      // signed-in user.
      hydrated: storageHydrated && clerkLoaded,
      signedIn: !!isSignedIn || pendingVerification,
      emailVerified: !!isSignedIn,
      email: pendingEmail,
      isStreaming,
      active,
      visibleConversations: state.conversations.filter((c) => !c.archived),
      archivedConversations: state.conversations.filter((c) => c.archived),
      newConversation,
      openConversation,
      sendMessage,
      regenerate,
      stopStreaming,
      deleteConversation,
      setArchived,
      setModel: (model) => setState((prev) => ({ ...prev, model })),
      setVoice: (voice) => setState((prev) => ({ ...prev, voice })),
      setHapticsEnabled: (hapticsEnabled) => setState((prev) => ({ ...prev, hapticsEnabled })),
      authToken: token,
      signOut: () => {
        clearTimer();
        /*
         * Chats are wiped from the device, not just deselected: they are the
         * previous account's, and the next sign-in re-fetches whatever that
         * account actually owns. They remain on the server either way.
         */
        setState((prev) => ({ ...prev, conversations: [], activeId: null }));
        /*
         * Two different exits share this button: a verified user ends a real
         * session, while someone who never entered their code only has a local
         * attempt to throw away -- calling signOut() there would be a no-op and
         * would strand them on the verify screen.
         */
        const done = isSignedIn ? clerkSignOut() : resetFlow();
        done.catch(() => {
          // Sign-out is best effort: the local state above is already cleared.
        });
      },
    };
  }, [
    clerkLoaded,
    clerkSignOut,
    clearTimer,
    deleteConversation,
    isSignedIn,
    isStreaming,
    pendingEmail,
    pendingVerification,
    resetFlow,
    storageHydrated,
    newConversation,
    openConversation,
    regenerate,
    sendMessage,
    setArchived,
    state,
    stopStreaming,
    token,
  ]);

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChatStore(): ChatStoreValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChatStore must be used inside <ChatStoreProvider>');
  return ctx;
}
