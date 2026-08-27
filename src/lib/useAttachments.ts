import { useCallback, useRef, useState } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { createId } from './id';
import { uploadAttachment, type ApiAttachment, type GetToken } from './api';
import type { PendingAttachment } from '../store/types';

/**
 * The composer's pending files: picking them, uploading them, and what to send.
 *
 * Uploading starts the moment a file is picked rather than when the turn is sent.
 * The pipeline takes seconds for a photo and longer for a document with pages to
 * render, and a send that blocked on that would be a button that does nothing for
 * five seconds. Picked early, the wait happens while the user is still typing their
 * question, and by the time they hit send there is usually nothing left to wait for.
 *
 * Mirrors the server's own cap (MAX_ATTACHMENTS_PER_TURN in
 * server/src/attachments.ts): over it the request is rejected outright, so the limit
 * is enforced here where it can be explained instead.
 */
const MAX_PER_TURN = 4;

/** What the pipeline accepts, as the two pickers ask for it. */
const DOCUMENT_TYPES = [
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'application/rtf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
];

/** Best guess at a type when a picker does not report one, from the extension. */
function guessMimeType(name: string, fallback: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const known: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    heic: 'image/heic',
    heif: 'image/heif',
    gif: 'image/gif',
    pdf: 'application/pdf',
    txt: 'text/plain',
    md: 'text/markdown',
    csv: 'text/csv',
    json: 'application/json',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
  return known[ext] ?? fallback;
}

export type UseAttachments = {
  attachments: PendingAttachment[];
  /** Uploaded results for the ones that finished, which is what a turn carries. */
  ready: ApiAttachment[];
  /** True while any of them is still going up, so send can say "wait". */
  busy: boolean;
  pickPhotos: () => Promise<string | null>;
  pickFiles: () => Promise<string | null>;
  remove: (id: string) => void;
  clear: () => void;
};

export function useAttachments(getToken: GetToken): UseAttachments {
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  /*
   * Read inside the picker callbacks, which run after an `await` and would otherwise
   * see the list as it was before the system sheet opened -- picking twice in a row
   * would then let the second pick past the cap.
   */
  const countRef = useRef(0);
  countRef.current = attachments.length;

  const patch = useCallback((id: string, next: Partial<PendingAttachment>) => {
    setAttachments((prev) => prev.map((a) => (a.id === id ? { ...a, ...next } : a)));
  }, []);

  /** Adds one picked file and starts its upload. */
  const add = useCallback(
    (item: Omit<PendingAttachment, 'id' | 'status'>) => {
      const id = createId('att');
      setAttachments((prev) => [...prev, { ...item, id, status: 'uploading' }]);

      void (async () => {
        try {
          const remote = await uploadAttachment(getToken, {
            uri: item.uri,
            name: item.name,
            mimeType: item.mimeType,
          });
          patch(id, { status: 'ready', remote, error: undefined });
        } catch (error) {
          /*
           * The server's own message, which is written to be read: "too large, the
           * limit is 20MB", "that kind of file cannot be attached". Only a failure
           * with no message falls back to something generic.
           */
          patch(id, {
            status: 'failed',
            error: error instanceof Error ? error.message : 'Upload failed.',
          });
        }
      })();
    },
    [getToken, patch],
  );

  /** How many more fit, and the note to show when none do. */
  const room = useCallback(() => Math.max(0, MAX_PER_TURN - countRef.current), []);

  const pickPhotos = useCallback(async (): Promise<string | null> => {
    const free = room();
    if (free === 0) return `Up to ${MAX_PER_TURN} files per message`;

    /*
     * No permission request: reading the library through the system picker does not
     * need one, and asking for it anyway is a dialog the user has to dismiss before
     * they can attach a photo.
     */
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: free,
      // Re-encoded a little: the pipeline optimises it again anyway, and a 12MP
      // original is a long upload for a photo the model sees at 1400px.
      quality: 0.85,
      exif: false,
    });
    if (result.canceled) return null;

    for (const asset of result.assets.slice(0, free)) {
      const name = asset.fileName || `photo-${Date.now()}.jpg`;
      if (__DEV__) {
        console.log(
          `[pick] photo name=${JSON.stringify(name)} picker.mimeType=${JSON.stringify(asset.mimeType ?? null)} size=${asset.fileSize ?? '-'} uri=${asset.uri}`,
        );
      }
      add({
        kind: 'image',
        name,
        mimeType: asset.mimeType || guessMimeType(name, 'image/jpeg'),
        size: asset.fileSize ?? 0,
        uri: asset.uri,
      });
    }
    return null;
  }, [add, room]);

  const pickFiles = useCallback(async (): Promise<string | null> => {
    const free = room();
    if (free === 0) return `Up to ${MAX_PER_TURN} files per message`;

    const result = await DocumentPicker.getDocumentAsync({
      type: DOCUMENT_TYPES,
      // The pipeline needs the bytes, so the file has to be readable from here.
      copyToCacheDirectory: true,
      multiple: true,
    });
    if (result.canceled) return null;

    for (const asset of result.assets.slice(0, free)) {
      const mimeType = asset.mimeType || guessMimeType(asset.name, 'application/octet-stream');
      if (__DEV__) {
        console.log(
          `[pick] file name=${JSON.stringify(asset.name)} picker.mimeType=${JSON.stringify(asset.mimeType ?? null)} resolved=${mimeType} size=${asset.size ?? '-'} uri=${asset.uri}`,
        );
      }
      add({
        // A photo picked through the file browser is still a photo.
        kind: mimeType.startsWith('image/') ? 'image' : 'document',
        name: asset.name,
        mimeType,
        size: asset.size ?? 0,
        uri: asset.uri,
      });
    }
    return null;
  }, [add, room]);

  const remove = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const clear = useCallback(() => setAttachments([]), []);

  return {
    attachments,
    ready: attachments
      .map((a) => a.remote)
      .filter((remote): remote is ApiAttachment => remote !== undefined),
    busy: attachments.some((a) => a.status === 'uploading'),
    pickPhotos,
    pickFiles,
    remove,
    clear,
  };
}
