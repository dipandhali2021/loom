/**
 * A model id, as a name to show: 'qwen-3.7-max-combo' -> 'Qwen 3.7 Max'.
 *
 * A copy of `deriveLabel` in `server/src/models.ts`, and it must stay one -- the two
 * are compared by eye, not by the compiler, because the app and the API are separate
 * packages with incompatible tsconfigs (the server needs `nodenext` plus
 * `allowImportingTsExtensions` for its generated Prisma client) and neither can
 * import from the other.
 *
 * Duplicated rather than left to the server alone because the label has to be
 * available before the catalog is. The stored model id comes back from AsyncStorage
 * in a few milliseconds; the catalog is a network round trip behind it. Deriving the
 * name locally is what lets the composer name the model immediately instead of
 * showing a placeholder and then replacing it a second later.
 *
 * Since the server derives its label exactly this way, the string this returns is
 * byte-identical to the one the catalog will bring -- so when the real list lands,
 * nothing on screen changes.
 */
export function deriveModelLabel(id: string): string {
  const withoutOwner = id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id;
  const stem = withoutOwner.replace(/-combo$/, '');
  const words = stem
    .split(/[-_]+/)
    .filter(Boolean)
    // A word carrying a digit is a version, and versions are not title-cased: '3.7'
    // has no case to change, and 'v2' would become 'V2'.
    .map((word) => (/\d/.test(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)));
  // An id that was nothing but "-combo" would leave no words; show it verbatim
  // rather than an empty chip.
  return words.length > 0 ? words.join(' ') : withoutOwner;
}
