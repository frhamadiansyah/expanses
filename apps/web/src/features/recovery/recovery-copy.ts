import type { RecoveryKind, RecoveryReason, SnapshotInfo } from '../../db/open';

/** The four things the screen can offer. Every one of them is a button; none of them is a dead end. */
export type RecoveryAction = 'export' | 'restore' | 'retry' | 'start-fresh';

export interface RecoveryCopy {
  /** One line, in the user's words. Never the technical text, which lives under "Details". */
  headline: string;
  /** Two or three sentences saying what this means for their data, and what to do next. */
  body: string;
  /** Which buttons the screen draws, in a fixed order so the same failure always looks the same. */
  actions: RecoveryAction[];
}

export interface RecoveryOptions {
  /** Whether a copy taken before an update is on the device to go back to. */
  hasSnapshot: boolean;
  /** True when the user asked for this screen (`?recover`) rather than being sent here by a failure. */
  requested?: boolean;
}

/**
 * What the recovery screen says, and which buttons it draws.
 *
 * The copy lives here rather than in the screen so it can be read and tested as prose. Three rules hold
 * for every line of it: the data is still on the device until the user themselves says otherwise; nothing
 * blames the user; and no sentence ever suggests deleting the app to fix it. `reason.headline` from the
 * opener is deliberately not reused — it is written for a log line, this is written for a person — and
 * `reason.detail` never appears above the fold.
 */
/**
 * The one sentence a screen that arrived mid-session owes the user, and the open-time screens do not.
 *
 * They were looking at their money a moment ago and the app has just gone out from under them. Said
 * before anything else is asked of them: nothing was deleted, the thing they lost is the screen, and the
 * app stopped on purpose rather than carrying on writing to a file that had stopped answering.
 */
export const MID_SESSION_NOTE = 'Expanses stopped here rather than keep writing to it, so what you have lost is the screen you were on, not your money.';

export function recoveryCopy(reason: RecoveryReason, options: RecoveryOptions): RecoveryCopy {
  const { headline, body } = words(reason);
  return {
    headline: options.requested ? 'Recovery tools' : headline,
    body: options.requested
      ? 'Nothing has gone wrong. This screen never opens your data, so you can take a copy of it, put back the last good copy, or start again from here even when opening is what breaks.'
      : reason.midSession
        ? `${MID_SESSION_NOTE} ${body}`
        : body,
    actions: actionsFor(reason, options),
  };
}

/**
 * Which buttons are honest here.
 *
 * `export` and anything that writes need storage to be working at all, which is what `exportable` says: a
 * device where the engine never started has no bytes to hand over and nowhere to put bytes back. `restore`
 * additionally needs a copy to go back to, and means nothing in three cases: an app that is merely too old,
 * where the data is newer than every copy we hold; an update that has *already* been put back, where the
 * live file is that copy and the button would do nothing at all; and a second tab, where the tab that got
 * there first holds the file open and nothing can be written. `start-fresh` is withheld from exactly the
 * two failures that are not about the file: an app that is behind its data, and a second tab. `retry` is
 * always there, because a screen with no way forward is the white screen this replaces.
 */
function actionsFor(reason: RecoveryReason, { hasSnapshot }: RecoveryOptions): RecoveryAction[] {
  const writable = reason.exportable && reason.kind !== 'locked';
  const actions: RecoveryAction[] = [];
  if (reason.exportable) actions.push('export');
  if (writable && hasSnapshot && reason.kind !== 'newer-database' && !reason.rolledBack) actions.push('restore');
  actions.push('retry');
  if (writable && reason.kind !== 'newer-database') actions.push('start-fresh');
  return actions;
}

/**
 * The newest copy worth putting back, or null.
 *
 * A `before-restore` copy is skipped, however new it is. It is the undo net for a restore that went wrong —
 * a copy *of what was replaced* — so after putting back a good copy over a corrupt file, the newest copy on
 * the device is a copy of the corruption. Offering that as "the last good copy" would hand the user their
 * own corruption back on the second press. It stays listed among the copies they can choose from by hand,
 * which is where an undo belongs, and never under the button that promises a good one.
 */
export function lastGoodCopy(list: SnapshotInfo[]): SnapshotInfo | null {
  return [...list].sort((a, b) => b.takenAt.localeCompare(a.takenAt)).find((copy) => copy.reason !== 'before-restore') ?? null;
}

/** A size a person can weigh: "4.2 MB", not "4,404,019 bytes". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** When a copy was taken, in the device's own language and time zone. */
export function formatWhen(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return at.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function words(reason: RecoveryReason): { headline: string; body: string } {
  const kind: RecoveryKind = reason.kind;
  switch (kind) {
    case 'cannot-open':
      return {
        headline: 'We could not open your data this time',
        body: 'Your transactions, accounts and cards are still stored on this device. Something went wrong while opening them, which is usually temporary. Try again first — and take a copy while you are here, so you have one whatever happens next.',
      };
    case 'unreadable':
      // Mid-session it did open — it stopped answering afterwards — so the headline has to say the true
      // thing rather than the near one. The body is the same either way: it is the same file, in the same
      // place, and the same three things are worth doing about it.
      return {
        headline: reason.midSession ? 'Your data stopped answering' : 'Your data is on this device, but it would not open',
        body: 'The file is where it should be; it just did not answer this time. Another tab, a browser update or a device that was busy can all do this. Try again, and take a copy first so you are holding one either way.',
      };
    case 'corrupt':
      return {
        headline: 'Part of your data would not read',
        body: 'The file is still on this device and most of it is almost certainly fine. You can take a copy of it exactly as it is now, and put back the last good copy if there is one. Nothing is removed unless you ask for it.',
      };
    case 'newer-database':
      return {
        headline: 'This data was made by a newer version of Expanses',
        body: 'Your data is safe and untouched. This copy of the app is older than the data on this device, so it will not open it rather than risk changing it. Update Expanses — or reopen it in the browser or device you last used — and it will open as usual.',
      };
    case 'migration-failed':
      return reason.rolledBack
        ? {
            headline: 'Your update was undone',
            body: 'The update stopped part-way, so your data was put back exactly as it was before it started. Nothing was lost. Take a copy if you would like one, then try again — Expanses will open on your data as it was and leave that update alone.',
          }
        : {
            headline: 'The update to your data could not be finished',
            body: 'Your data has not been left half-changed: the update stopped rather than carry on. You can take a copy, or put back the copy taken just before the update, and then try again.',
          };
    case 'verify-failed':
      return reason.rolledBack
        ? {
            headline: 'Your update was undone',
            body: 'We checked your data after the update, something did not add up, and the update was put back exactly as it was before. Nothing was lost. Take a copy if you would like one, then try again.',
          }
        : {
            headline: 'Something did not add up after the update',
            body: 'Your data is still on this device. The check we run after every update found something it did not expect, so the app stopped here instead of carrying on. Take a copy, then try again or put back the last good copy.',
          };
    case 'locked':
      return {
        headline: 'Expanses is already open in another tab',
        body: 'Only one tab can use your data at a time, so that two of them can never write over each other. Close the other Expanses tab or window, then try again here.',
      };
  }
}
