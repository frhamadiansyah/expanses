/**
 * How large a database is still worth a `PRAGMA quick_check(1)` before the app opens.
 *
 * Spec §11.4 bought a check at every open with one measurement — 15 ms on the 1.4 MB sample — and asked
 * for "a size guard [that] prunes to a post-migration-only check if a real measurement ever exceeds
 * 400 ms". That measurement is roughly 11 ms per megabyte, which puts 400 ms somewhere near 37 MB; 32 MiB
 * is the round number below it. Past that the structural check happens only after an update, where the
 * wait is earned because something has just been written.
 *
 * It lives in a module of its own, with no imports at all, so the end-to-end fixture that has to produce a
 * database on the far side of this line can read the line itself. `open.ts` re-exports both names, so every
 * existing `from './open'` keeps working.
 */
export const QUICK_CHECK_LIMIT_BYTES = 32 * 1024 * 1024;

/**
 * Whether a file of this size can afford the pre-open `quick_check`. A file that will not say how big it
 * is (`null`) is checked regardless: a database too broken to report its own size is exactly one worth
 * asking SQLite about.
 */
export const quickCheckAffordable = (bytes: number | null): boolean => bytes === null || bytes <= QUICK_CHECK_LIMIT_BYTES;
