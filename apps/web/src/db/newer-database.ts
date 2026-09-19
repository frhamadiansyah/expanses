/**
 * The refusal that keeps an old app away from newer data.
 *
 * A file written by a build that knows more migrations than this one must never be opened, migrated or
 * adopted: an older app writing into a newer schema is how a ledger is destroyed rather than merely
 * broken. `openSafely` refuses it at the door; this is the same refusal one step earlier, at the moment a
 * restore would make such a file the live database.
 *
 * The marker travels as an error message because that is all the worker can throw back across a
 * postMessage boundary. The worker deliberately does not import `@expanses/db` — `LATEST_VERSION` rides
 * in on the request instead — so this module holds no dependency of its own and both sides can share it.
 */
export const NEWER_DATABASE = 'NEWER_DATABASE:';

/** The version recorded in a refused file, or null when the failure was something else entirely. */
export function newerDatabaseVersion(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.startsWith(NEWER_DATABASE)) return null;
  const version = Number(message.slice(NEWER_DATABASE.length));
  return Number.isFinite(version) ? version : null;
}

/**
 * The refusal in the user's words, for the screen they are standing on when it happens.
 *
 * Three things have to be in it: that nothing on this device changed, which is the fear; that the app is
 * what is behind, not the data, which is the fact; and what to do about it. Never "delete", never "start
 * fresh" — the most likely reader is someone restoring their own current backup onto an old build.
 */
export function refusedCopyMessage(fileVersion: number, appVersion: number): string {
  return `This data was made by a newer version of Expanses. Nothing on this device was changed: that copy was written by update ${fileVersion}, and this app knows up to update ${appVersion}. Update Expanses, then try it again.`;
}

/** The same failure as an Error an ErrorBox can show, or null when it is not this failure. */
export function refusedCopy(error: unknown, appVersion: number): Error | null {
  const version = newerDatabaseVersion(error);
  return version === null ? null : new Error(refusedCopyMessage(version, appVersion));
}
