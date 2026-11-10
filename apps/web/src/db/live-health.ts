/**
 * Whether the live database looks healthy enough to copy over the copies already kept, from the two answers
 * the engine gives: does `schema_migrations` exist, and what did `PRAGMA quick_check(1)` say. Null when it
 * does; otherwise what is wrong, in a sentence for the console.
 *
 * Kept on its own, with no imports, so the SQLite worker can bundle it and the unit tests can ask it the same
 * question over a Node database. It is the gate for the copy taken when the app leaves the foreground: a copy
 * of a damaged or emptied file must never be the newest copy on the device, pushing a good one out.
 */
export function liveProblem(answers: { hasSchema: boolean; structure: unknown }): string | null {
  if (!answers.hasSchema) return 'the live database holds no schema_migrations table';
  if (answers.structure !== 'ok') return `the live database did not check out: ${String(answers.structure)}`;
  return null;
}

/** What the engine hands back for a checked copy: its change count, and the bytes when anything had changed. */
export interface CheckedSnapshot {
  /** `total_changes()` on the engine's connection when the copy was asked for. */
  changes: number;
  /** The file, read between statements after the checks passed; null when nothing had changed since `since`. */
  bytes: Uint8Array | null;
}
