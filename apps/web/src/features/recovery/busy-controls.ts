/**
 * Which buttons on the recovery screen go dead while something is running, and which never do.
 *
 * The screen holds a `busy` flag from the moment an action starts until it settles, and everything on it
 * used to be `disabled={busy}`. That is the right instinct for a restore — two of them at once would be a
 * race over the same file — but it was applied to the way out as well, and the way out is the whole reason
 * this screen exists. The work it waits on is a single message to a worker of its own with no bound on it
 * (`salvage.ts`): a restore or a wipe that quietly never answers left the last-resort screen with every
 * control disabled, no error, and no spinner text, and left the Start fresh sheet unable even to be shut.
 * A reload still got the user out with nothing lost, but a screen whose purpose is to never be a dead end
 * must not be able to become one.
 *
 * The bound belongs in `askWorker`, and it cannot simply be added there: the borrowed worker's one message
 * *is* its handshake, so a timer could not tell a restore that has hung from a restore that is halfway
 * through rewriting the file, and terminating the second is a safety mechanism destroying data. This is the
 * other half, and it is the half that costs nothing. An escape is anything that only navigates, reloads or
 * closes — it touches no file, needs no engine, and cannot collide with whatever is in flight — so it stays
 * pressable throughout. Everything that writes, or that would start a second piece of work over the same
 * bytes, still waits its turn. A frozen screen becomes a survivable wait.
 */
export type RecoveryControl =
  /** Puts a kept copy back over the live database. */
  | 'restore'
  /** Reads the bytes off the device and hands them to the browser as a download. */
  | 'export'
  /** Reloads the app at its own path. Writes nothing, opens nothing. */
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
 * The controls that stay pressable however long an action takes.
 *
 * Both of them are exits and neither touches storage: `retry` sets `window.location` and `keep-my-data`
 * closes a sheet. Pressing either while a restore is in flight does not interrupt it — the borrowed worker
 * has the bytes and finishes or rolls itself back regardless — it just stops the user being held hostage
 * by it.
 */
export const ESCAPES: readonly RecoveryControl[] = ['retry', 'keep-my-data'];

/** Whether `control` is disabled right now, given whether the screen has an action in flight. */
export function disabledWhileBusy(control: RecoveryControl, busy: boolean): boolean {
  return busy && !ESCAPES.includes(control);
}
