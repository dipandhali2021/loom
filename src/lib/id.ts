let counter = 0;

/** Monotonic, collision-free id for locally created records. */
export function createId(prefix = 'id'): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`;
}
