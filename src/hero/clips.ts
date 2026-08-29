/**
 * The clips the login screen cycles through, in order.
 *
 * `require` rather than a remote URL on purpose: the hero is the first thing the
 * app draws, and a login screen that needs the network before it can paint its
 * own background is a worse first launch than one that ships its background in
 * the bundle.
 *
 * To add a clip, encode it and add a line:
 *
 *   ./scripts/encode-hero.sh <source.mp4> hero-03 [start-seconds]
 *
 * The script crops to the same 9:19.5 portrait frame and trims to CLIP_SECONDS,
 * so every entry here is interchangeable however large its source was.
 */
export const HERO_CLIPS = [
  // require('../../assets/videos/hero/hero-01.mp4'),
  require('../../assets/videos/hero/hero-02.mp4'),
  require('../../assets/videos/hero/hero-03.mp4'),
  require('../../assets/videos/hero/hero-04.mp4'),
  require('../../assets/videos/hero/hero-05.mp4'),
] as const;

/** What `scripts/encode-hero.sh` trims each clip to. */
export const CLIP_SECONDS = 6;
