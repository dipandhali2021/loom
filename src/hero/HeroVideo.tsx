import React, { useCallback, useEffect, useRef } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { VideoView, useVideoPlayer, type VideoPlayer } from 'expo-video';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { HERO_CLIPS, CLIP_SECONDS } from './clips';
import { HeroScrim } from './HeroScrim';
import { palette } from '../theme/tokens';

/** The repo's open curve (ModelSheet, SourcesSheet). */
const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1);

/** Long enough to read as a dissolve rather than a cut, short enough to stay on the beat. */
const FADE_MS = 900;

/** How far the Ken Burns push travels over one clip. Past ~1.08 the crop starts to show. */
const DRIFT_TO = 1.06;

type Props = {
  /**
   * Fired on each cross-fade. Carries no clip index on purpose: the screen owns
   * the wordmark and has its own number of phrases, so tying copy to a clip
   * number would cap the rotation at however many clips are in the manifest.
   * This is a beat, and the screen decides what changes on it.
   */
  onBeat?: () => void;
};

/**
 * The login screen's background: the clips in `HERO_CLIPS`, cross-fading into one
 * another with a slow scale drift, dimmed under `HeroScrim`.
 *
 * Two players rather than one, and two `VideoView`s rather than one: mounting two
 * views against a single player does not work on Android (expo#35012), and a
 * cross-fade needs the outgoing frame to stay on screen while the incoming one
 * comes up. They alternate -- whichever just finished loads the clip after next,
 * so a manifest of any length rotates through the same two players.
 */
export function HeroVideo({ onBeat }: Props) {
  const playerA = useVideoPlayer(HERO_CLIPS[0], setUpPlayer);
  const playerB = useVideoPlayer(HERO_CLIPS[1 % HERO_CLIPS.length], setUpPlayer);

  const opacityA = useSharedValue(1);
  const opacityB = useSharedValue(0);
  const drift = useSharedValue(1);

  /*
   * The clip each player holds. A ref, not state: `playToEnd` fires from native
   * and the handler needs the current value without re-subscribing on every
   * switch, and nothing renders off it.
   */
  const clipOf = useRef<{ a: number; b: number }>({ a: 0, b: 1 % HERO_CLIPS.length });
  const frontRef = useRef<'a' | 'b'>('a');

  /** The pending source swap, so unmounting mid-fade does not touch a released player. */
  const queued = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (queued.current) clearTimeout(queued.current);
  }, []);

  const advance = useCallback(() => {
    const outgoing = frontRef.current;

    // A single clip has nothing to cross-fade to, so it just runs again.
    if (HERO_CLIPS.length < 2) {
      (outgoing === 'a' ? playerA : playerB).replay();
      return;
    }

    const incoming = outgoing === 'a' ? 'b' : 'a';
    const incomingPlayer = incoming === 'a' ? playerA : playerB;
    const outgoingPlayer = outgoing === 'a' ? playerA : playerB;

    // The incoming player has been buffering this clip since the last switch, so
    // it has frames ready before its fade begins -- no black flash on the way in.
    incomingPlayer.replay();
    incomingPlayer.play();

    frontRef.current = incoming;
    onBeat?.();

    const opacityIn = incoming === 'a' ? opacityA : opacityB;
    const opacityOut = incoming === 'a' ? opacityB : opacityA;
    opacityIn.value = withTiming(1, { duration: FADE_MS, easing: EASE_OUT });
    opacityOut.value = withTiming(0, { duration: FADE_MS, easing: EASE_OUT });

    // Both views share one drift, so the push is continuous across the fade
    // rather than snapping back while the outgoing frame is still visible.
    drift.value = 1;
    drift.value = withTiming(DRIFT_TO, {
      duration: CLIP_SECONDS * 1000 + FADE_MS,
      easing: Easing.linear,
    });

    /*
     * Queue the clip after next onto the player that just went dark, once its
     * fade is done -- swapping the source under a visible view would show the
     * new clip's first frame mid-dissolve.
     */
    const next = (clipOf.current[incoming] + 1) % HERO_CLIPS.length;
    queued.current = setTimeout(() => {
      clipOf.current[outgoing] = next;
      outgoingPlayer.replaceAsync(HERO_CLIPS[next]).catch(() => {
        // A source that will not load leaves the other player carrying the
        // rotation; the background keeps moving either way.
      });
    }, FADE_MS);
  }, [drift, onBeat, opacityA, opacityB, playerA, playerB]);

  useEffect(() => {
    const subscriptions = [
      playerA.addListener('playToEnd', () => {
        if (frontRef.current === 'a') advance();
      }),
      playerB.addListener('playToEnd', () => {
        if (frontRef.current === 'b') advance();
      }),
    ];
    return () => subscriptions.forEach((s) => s.remove());
  }, [advance, playerA, playerB]);

  // First clip: start it and begin the drift the fade handler otherwise renews.
  useEffect(() => {
    playerA.play();
    drift.value = withTiming(DRIFT_TO, {
      duration: CLIP_SECONDS * 1000 + FADE_MS,
      easing: Easing.linear,
    });
  }, [drift, playerA]);

  /*
   * Coming back from the background leaves the player paused -- and a paused
   * clip never reaches its end, so the rotation would stop for good rather than
   * just for as long as the app was away.
   */
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      (frontRef.current === 'a' ? playerA : playerB).play();
    });
    return () => subscription.remove();
  }, [playerA, playerB]);

  const driftStyle = useAnimatedStyle(() => ({ transform: [{ scale: drift.value }] }));
  const styleA = useAnimatedStyle(() => ({ opacity: opacityA.value }));
  const styleB = useAnimatedStyle(() => ({ opacity: opacityB.value }));

  return (
    <View style={[styles.fill, styles.base]} pointerEvents="none">
      <Animated.View style={[styles.fill, driftStyle]}>
        <Animated.View style={[styles.fill, styleA]}>
          <Surface player={playerA} />
        </Animated.View>
        {HERO_CLIPS.length > 1 ? (
          <Animated.View style={[styles.fill, styleB]}>
            <Surface player={playerB} />
          </Animated.View>
        ) : null}
      </Animated.View>
      <HeroScrim />
    </View>
  );
}

/** Applied to both players: silent, non-looping wallpaper. */
function setUpPlayer(player: VideoPlayer) {
  player.muted = true;
  // `loop` off because the switch hangs off `playToEnd`, which a looping player
  // never emits. A single-clip manifest is handled by replaying it in `advance`.
  player.loop = false;
  player.audioMixingMode = 'mixWithOthers';
  player.showNowPlayingNotification = false;
  player.staysActiveInBackground = false;
}

function Surface({ player }: { player: VideoPlayer }) {
  return (
    <VideoView
      player={player}
      style={styles.fill}
      contentFit="cover"
      nativeControls={false}
      /*
       * Two overlapping `cover` views render out of bounds on a SurfaceView
       * (androidx/media#1107); a TextureView composites correctly. iOS ignores it.
       */
      surfaceType="textureView"
      // The shutter is a black hold before the first frame -- exactly what the
      // cross-fade is there to avoid.
      useExoShutter={false}
      pointerEvents="none"
    />
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  /*
   * Only the root is filled. A black background on the layers themselves would
   * darken the outgoing clip through the incoming one mid-fade -- the dissolve
   * has to be video over video, with the fill only ever behind both.
   */
  base: { backgroundColor: palette.black },
});
