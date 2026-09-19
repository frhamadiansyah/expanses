/**
 * Which buttons on the recovery screen go dead while something is running, and which never do.
 *
 * The screen holds what it is waiting on from the moment an action starts until it settles, and everything
 * on it used to be `disabled={busy}`. That is the right instinct for a restore — two of them at once would
 * be a race over the same file — but it was applied to the way out as well, and the way out is the whole
 * reason this screen exists. The work it waits on is a single message to a worker of its own with no bound
 * on it (`salvage.ts`): a restore or a wipe that quietly never answers left the last-resort screen with
 * every control disabled, no error, and no busy text, and left the Start fresh sheet unable even to be
 * shut. A reload still got the user out with nothing lost, but a screen whose purpose is to never be a
 * dead end must not be able to become one.
 *
 * The bound belongs in `askWorker`, and it cannot simply be added there: the borrowed worker's one message
 * *is* its handshake, so a timer could not tell a restore that has hung from a restore that is halfway
 * through rewriting the file, and terminating the second is a safety mechanism destroying data. This is the
 * other half. It is not free, and pretending it was is what the first version of this file got wrong.
 *
 * What stays pressable is decided per action, by {@link PRESSABLE_DURING}, because the two controls this
 * screen could hold back are not alike:
 *
 * - `keep-my-data` closes a sheet. The wipe it might be waiting on lives in a closure on a worker of its
 *   own; unmounting the dialog neither reaches it nor needs it. It is a true escape and is never withheld.
 * - `retry` is a *navigation*, and a dedicated worker's lifetime is its document's. Navigating away
 *   terminates the worker the restore borrowed, with no grace — between `worker.ts:72`, where it reads the
 *   previous bytes into memory, and `worker.ts:105`, where it puts them back, that leaves a torn live slot
 *   and throws that copy away. So it collides with exactly one kind of work, and is held back for exactly
 *   that one.
 *
 * Nothing is lost when it happens anyway — `restoreSnapshot` writes a `before-restore` copy first, so both
 * copies survive and the user lands back here with Restore still offered — but a button that can cut a
 * write in half is not an escape, and this screen should not offer it as one.
 *
 * Anything added below must be checked against the work in flight the same way: not "does it write?" but
 * "can pressing it end the worker, or the document, that the work is running in?"
 */
export type RecoveryControl =
  /** Puts a kept copy back over the live database. */
  | 'restore'
  /** Reads the bytes off the device and hands them to the browser as a download. */
  | 'export'
  /** Reloads the app at its own path. Writes nothing, opens nothing — and takes the page's workers with it. */
  | 'retry'
  /** Opens the Start fresh sheet, which is the first of the two presses that delete everything. */
  | 'start-fresh'
  /** The backup the sheet insists on before it will let anything be deleted. */
  | 'download-backup'
  /** The second press: the wipe itself, and the one action here that cannot be undone. */
  | 'delete-everything'
  /** Shuts the Start fresh sheet, having done nothing. */
  | 'keep-my-data';

/**
 * What the screen is waiting on, when it is waiting on something.
 *
 * Three kinds, because only three things are ever in flight here, and they differ in what a press could do
 * to them: `restore` is rewriting the live slot file through a borrowed worker, `export` is a read that
 * changes nothing, and `wipe` is removing files the user has twice asked to be rid of.
 */
export type RecoveryWork = 'restore' | 'export' | 'wipe';

/**
 * Which controls stay pressable, by what is running. Everything not listed for a kind of work is disabled
 * while that work is in flight.
 *
 * `keep-my-data` is on every row: it closes a dialog and touches nothing. `retry` is on every row but
 * `restore`'s, and that omission is the whole point of this table — a reload during an export loses a
 * download, which is an inconvenience, and a reload during a wipe leaves files the user asked to be gone,
 * which the next Start fresh finishes; a reload during a restore tears the file being written. Only the
 * last is damage, so only the last withholds the button.
 */
export const PRESSABLE_DURING: Record<RecoveryWork, readonly RecoveryControl[]> = {
  restore: ['keep-my-data'],
  export: ['retry', 'keep-my-data'],
  wipe: ['retry', 'keep-my-data'],
};

/** Whether `control` is disabled right now, given what the screen has in flight (null when nothing is). */
export function disabledWhileBusy(control: RecoveryControl, work: RecoveryWork | null): boolean {
  return work !== null && !PRESSABLE_DURING[work].includes(control);
}
