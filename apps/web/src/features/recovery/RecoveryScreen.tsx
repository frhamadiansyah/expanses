import { isoDate } from '@expanses/core';
import { LATEST_VERSION } from '@expanses/db';
import { useEffect, useState } from 'react';
import { refusedCopy } from '../../db/newer-database';
import { NO_SNAPSHOTS, type RecoveryReason, type SnapshotInfo, type SnapshotStore } from '../../db/open';
import { restoreBytes, salvageBytes } from '../../db/salvage';
import { restoreSnapshot } from '../../db/snapshots';
import { saveBytes } from '../../lib/download';
import { Button, ErrorBox } from '../../ui';
import { copyReasonWords } from '../backup/backupState';
import { disabledWhileBusy } from './busy-controls';
import { formatBytes, formatWhen, lastGoodCopy, recoveryCopy } from './recovery-copy';
import { StartFreshDialog } from './StartFreshDialog';

/** Dropping the query and the hash, so "Try again" leaves recovery mode instead of returning to it. */
const reopen = () => {
  window.location.href = window.location.pathname;
};

/**
 * The screen a user sees instead of a white one.
 *
 * It never opens the database. Everything it offers works on the bytes in storage directly — an export
 * reads the file, a restore hands saved bytes back to a fresh engine — so it still works on the device
 * where opening is exactly what breaks. Nothing here removes anything without two deliberate presses.
 */
export function RecoveryScreen({
  reason,
  requested = false,
  snapshots = NO_SNAPSHOTS,
}: {
  reason: RecoveryReason;
  /** True when the user asked for this screen with `?recover`, rather than being sent here by a failure. */
  requested?: boolean;
  snapshots?: SnapshotStore;
}) {
  const [kept, setKept] = useState<SnapshotInfo[]>([]);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [fresh, setFresh] = useState(false);

  useEffect(() => {
    let live = true;
    // Both reads are "what is actually on this device", which is what turns the reassurance in the copy
    // into something the user can see: a size, and the dates of the copies we hold.
    void snapshots
      .list()
      .then((list) => live && setKept([...list].sort((a, b) => b.takenAt.localeCompare(a.takenAt))))
      .catch(() => undefined);
    if (reason.exportable) void salvageBytes().then((found) => live && setBytes(found)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [snapshots, reason.exportable]);

  const copy = recoveryCopy(reason, { hasSnapshot: kept.length > 0, requested });
  // The one the button promises, and the rest, which the user can go through themselves. A copy taken
  // before a restore is never the first of those, but it is always among the second.
  const lastGood = lastGoodCopy(kept);
  const canRestore = copy.actions.includes('restore');
  const others = kept.filter((candidate) => candidate.file !== lastGood?.file);

  /** Puts `chosen` back, keeping a copy of what is on the device now so this is itself undoable. */
  const putBack = (chosen: SnapshotInfo) =>
    run('Restore', async () => {
      // What is on the device now is kept first, so restoring the wrong copy is an undo and
      // not the end of everything entered since that copy was taken.
      await restoreSnapshot({
        snapshots,
        file: chosen.file,
        live: async () => bytes ?? (await salvageBytes().catch(() => null)),
        restore: restoreBytes,
      });
      reopen();
    });

  async function run(what: string, action: () => Promise<void>) {
    setError(null);
    setNote(null);
    setBusy(true);
    try {
      await action();
    } catch (e) {
      // A copy written by a newer build is refused by the engine rather than put back; that refusal
      // arrives as a marker, and is the one failure here with words of its own.
      setError(refusedCopy(e, LATEST_VERSION) ?? e);
      console.warn(`${what} failed`, e);
    } finally {
      setBusy(false);
    }
  }

  const onExport = async () => {
    const found = bytes ?? (await salvageBytes());
    if (!found) throw new Error('We could not find the data file on this device. Try again, or reopen Expanses in the browser you last used.');
    setBytes(found);
    saveBytes(found, `expanses-recovery-${isoDate()}.sqlite3`, 'application/vnd.sqlite3');
    setNote('Saved to your downloads. Keep it somewhere private — it is all of your data.');
  };

  return (
    <div className="mx-auto max-w-md p-4">
      <div className="py-6">
        <h1 className="text-xl font-semibold text-balance text-slate-900">{copy.headline}</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">{copy.body}</p>
        {bytes && <p className="mt-2 text-sm text-slate-500">Your data on this device: {formatBytes(bytes.length)}.</p>}
      </div>

      {/* Stacked and 44px tall: on a phone this is the one screen where a missed tap costs the most. */}
      <div className="space-y-2">
        {canRestore && lastGood && (
          <Button variant="primary" className="min-h-11 w-full flex-col gap-0 py-2" disabled={disabledWhileBusy('restore', busy)} onClick={() => void putBack(lastGood)}>
            <span className="block">Restore the last good copy</span>
            {/* What is actually being put back, so nobody presses this without knowing what they lose. */}
            <span className="mt-0.5 block text-xs font-normal opacity-80">
              From {formatWhen(lastGood.takenAt)} · {formatBytes(lastGood.bytes)}
            </span>
          </Button>
        )}
        {copy.actions.includes('export') && (
          <Button variant="secondary" className="min-h-11 w-full" disabled={disabledWhileBusy('export', busy)} onClick={() => run('Export', onExport)}>
            Download a copy of my data
          </Button>
        )}
        {copy.actions.includes('retry') && (
          <Button variant={copy.actions.includes('restore') ? 'secondary' : 'primary'} className="min-h-11 w-full" disabled={disabledWhileBusy('retry', busy)} onClick={reopen}>
            Try again
          </Button>
        )}
      </div>

      {/*
        Every other copy the device holds, with the date, the size and why it was taken — because the newest
        is not always the one the user wants. Someone who has just put back a copy from last week needs the
        one taken before that restore; someone whose data went wrong this morning needs yesterday's. Shut by
        default, so the screen still has one obvious thing to press.
      */}
      {canRestore && others.length > 0 && (
        <details className="mt-3 rounded-lg bg-slate-50 px-3 py-2">
          <summary className="cursor-pointer py-1 text-sm text-slate-700">{lastGood ? 'Choose a different copy' : 'Choose a copy to put back'}</summary>
          <ul className="mt-1 divide-y divide-slate-200">
            {others.map((candidate) => (
              <li key={candidate.file} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="block text-sm text-slate-900">{formatWhen(candidate.takenAt)}</span>
                  <span className="block text-xs text-slate-500">
                    {copyReasonWords(candidate.reason)} · {formatBytes(candidate.bytes)}
                  </span>
                </span>
                <Button variant="secondary" className="min-h-11" disabled={disabledWhileBusy('restore', busy)} onClick={() => void putBack(candidate)}>
                  Restore this one
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {note && (
        <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">
          {note}
        </p>
      )}
      <div className="mt-3">
        <ErrorBox error={error} />
      </div>

      {kept[0] && !canRestore && <p className="mt-3 text-xs text-slate-500">The last copy we hold was taken on {formatWhen(kept[0].takenAt)}.</p>}

      <details className="mt-6 text-xs text-slate-500">
        <summary className="cursor-pointer py-2">Details</summary>
        <p className="mt-1 break-words">{reason.kind}</p>
        <p className="mt-1 break-words whitespace-pre-wrap">{reason.detail}</p>
      </details>

      {copy.actions.includes('start-fresh') && (
        <div className="mt-6 border-t border-slate-200 pt-4">
          <Button variant="ghost" onClick={() => setFresh(true)} disabled={disabledWhileBusy('start-fresh', busy)} className="px-0 text-xs font-normal text-red-700 underline underline-offset-2 hover:bg-transparent">
            Start fresh on this device
          </Button>
        </div>
      )}

      {fresh && (
        <StartFreshDialog sizeOnDevice={bytes?.length ?? null} snapshots={kept} onExport={onExport} onClose={() => setFresh(false)} />
      )}
    </div>
  );
}
