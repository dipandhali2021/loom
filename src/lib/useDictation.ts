import { useCallback, useRef, useState } from 'react';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { transcribe, type GetToken } from './api';

/**
 * The composer's mic: record, stop, transcribe into the draft.
 *
 * Distinct from voice mode, which is the trailing button and a screen of its own.
 * This one never speaks and never sends -- it writes into the field, where the user
 * reads it and edits it before deciding to send. That is also why the transcript is
 * appended rather than replacing what is there: dictating is the second half of a
 * sentence as often as it is the whole one.
 */

/** Ignore a tap-and-release: there is nothing in 400ms worth a round trip. */
const MIN_MS = 400;

export type DictationPhase = 'idle' | 'recording' | 'transcribing';

export type UseDictation = {
  phase: DictationPhase;
  /** Milliseconds recorded so far, for the running timer. */
  durationMillis: number;
  /** Refused permission, or a failed transcription, ready to show. */
  error: string | null;
  /** Start if idle, stop and transcribe if recording. The mic button's onPress. */
  toggle: () => void;
  /** Throw the clip away rather than transcribing it. */
  cancel: () => void;
  clearError: () => void;
};

export function useDictation(getToken: GetToken, onText: (text: string) => void): UseDictation {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  // 250ms rather than the default 500: this drives a timer the user is watching.
  const state = useAudioRecorderState(recorder, 250);

  const [phase, setPhase] = useState<DictationPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  /*
   * Guards the async gap. `toggle` is one button, and both halves of it await --
   * without this a double tap starts a second recording over the first, or stops a
   * recording that is already being stopped.
   */
  const working = useRef(false);
  const startedAt = useRef(0);

  const start = useCallback(async () => {
    setError(null);
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setError('Microphone access is off for this app.');
        return;
      }

      /*
       * `allowsRecording` is what actually opens the input on iOS, and
       * `playsInSilentMode` is what keeps a subsequent reply audible if the ringer
       * switch is off -- the mode is global, so leaving it out here would silence
       * voice mode later.
       */
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      startedAt.current = Date.now();
      setPhase('recording');
    } catch {
      setError('Could not start recording.');
      setPhase('idle');
    }
  }, [recorder]);

  const finish = useCallback(async () => {
    const elapsed = Date.now() - startedAt.current;
    try {
      await recorder.stop();
    } catch {
      // Already stopped, or the session was reset under us; the uri below decides.
    }
    // Read after stopping: the file is only complete once the recorder has closed it.
    const uri = recorder.uri;
    /*
     * Recording is left on -- the input stays open for the next tap rather than
     * being torn down and re-negotiated, which on iOS is an audible click.
     */

    if (!uri || elapsed < MIN_MS) {
      setPhase('idle');
      return;
    }

    setPhase('transcribing');
    try {
      const text = (await transcribe(getToken, { uri, mimeType: 'audio/m4a' })).trim();
      if (text) onText(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not transcribe that.');
    } finally {
      setPhase('idle');
    }
  }, [getToken, onText, recorder]);

  const toggle = useCallback(() => {
    if (working.current || phase === 'transcribing') return;
    working.current = true;
    void (async () => {
      try {
        if (phase === 'recording') await finish();
        else await start();
      } finally {
        working.current = false;
      }
    })();
  }, [finish, phase, start]);

  const cancel = useCallback(() => {
    if (phase !== 'recording') return;
    working.current = true;
    void (async () => {
      try {
        await recorder.stop();
      } catch {
        // Nothing to recover: the clip is being discarded either way.
      } finally {
        startedAt.current = 0;
        setPhase('idle');
        working.current = false;
      }
    })();
  }, [phase, recorder]);

  return {
    phase,
    durationMillis: phase === 'recording' ? state.durationMillis : 0,
    error,
    toggle,
    cancel,
    clearError: useCallback(() => setError(null), []),
  };
}
