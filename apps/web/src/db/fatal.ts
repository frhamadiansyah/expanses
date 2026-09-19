import type { RecoveryReason } from './open';

/**
 * Failures the session cannot carry on past — spec §3.4, "Corruption found while the app is running".
 *
 * `SQLITE_CORRUPT` and `SQLITE_NOTADB` do not only turn up at the door. A page can go bad, a sync access
 * handle can be taken away, a device can run out of disk, hours after the app opened — and the first sign
 * of it is an ordinary query answering with an error instead of rows. Left alone, that is a rejected
 * promise somewhere inside a screen: a broken panel here, a spinner that never stops there, and no route
 * to Export or Restore short of a reload the user has no reason to try.
 *
 * So the engine's own words are read once, here, and turned into the same typed `RecoveryReason` the open
 * path builds. This module is deliberately dependency-free — the worker imports it, and the worker must
 * not pull in `@expanses/db` — so the only thing it borrows from `./open` is a type, which the build
 * erases.
 *
 * Two kinds, because there are two honest things to say. `corrupt` is SQLite saying the bytes are wrong.
 * `unreadable` is SQLite saying it could not reach them: the file, the handle, or the engine itself has
 * gone. Neither means anything was lost — both screens still offer the file, byte for byte.
 */
export type FatalKind = 'corrupt' | 'unreadable';

/**
 * What SQLite says when the bytes themselves are wrong: `SQLITE_CORRUPT` ("database disk image is
 * malformed", "malformed database schema"), `SQLITE_NOTADB` ("file is not a database").
 *
 * Narrow on purpose. "That file is not an Expanses backup." and a `UNIQUE constraint failed` are ordinary
 * answers the app already handles, and tagging either of them would replace a working app with a recovery
 * screen over nothing at all.
 */
const CORRUPT = /malformed|disk image|not a database|SQLITE_CORRUPT|SQLITE_NOTADB/i;

/**
 * What it says when it cannot reach the bytes: a disk that answered with an error, a file that is no
 * longer there, a sync access handle the browser took back when it evicted the origin, a connection that
 * has been closed under the app.
 *
 * `database is locked` is deliberately absent: that is contention, it passes, and the app retries.
 */
const GONE =
  /disk I\/O error|SQLITE_IOERR|SQLITE_CANTOPEN|unable to open database file|(?:has been|is) closed|InvalidStateError|NoModificationAllowedError|NotFoundError|access handle/i;

/** The engine's message for an error, whatever shape it arrived in. */
export const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Which kind of fatal this is, or null when the session can carry on.
 *
 * Null is the answer for every ordinary failure — a constraint, a missing column, a copy refused because
 * it came from a newer build — and null must stay the common case: this decides whether the app the user
 * is looking at is taken away from them.
 */
export function fatalKind(error: unknown): FatalKind | null {
  const message = messageOf(error);
  if (CORRUPT.test(message)) return 'corrupt';
  if (GONE.test(message)) return 'unreadable';
  return null;
}

/**
 * The typed reason a mid-session fatal is shown as.
 *
 * `exportable` is true for both kinds and that is not optimism: the recovery screen exports by reading the
 * VFS slot files straight off OPFS, without the engine, so it hands back whatever is still there even when
 * SQLite will not look at it. `midSession` is what lets the copy say the one thing this screen has to say
 * and the open-time screens do not — that the app was open a moment ago, and that what went is the screen,
 * not the money.
 */
export function fatalReason(kind: FatalKind, detail: string): RecoveryReason {
  return {
    kind,
    headline:
      kind === 'corrupt'
        ? 'Your data is still on this device, but part of it stopped reading while the app was open.'
        : 'Your data stopped answering while the app was open.',
    detail,
    exportable: true,
    midSession: true,
  };
}
