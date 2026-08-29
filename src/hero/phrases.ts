/**
 * The wordmark line, one per clip. The login screen steps through these on the
 * hero's cross-fade, so a phrase belongs to whichever clip is coming in --
 * `index % PHRASES.length` keeps that true whether there are more clips than
 * phrases or fewer.
 *
 * `null` is the bare dot, which is how the design's first Login variant reads.
 */
export const PHRASES = [null, 'Loom', 'Let’s brainstorm', 'Let’s go'] as const;
