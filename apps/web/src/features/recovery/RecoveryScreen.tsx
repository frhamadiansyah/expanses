import { isoDate } from '@expanses/core';
import { LATEST_VERSION } from '@expanses/db';
import { useEffect, useState } from 'react';
import { refusedCopy } from '../../db/newer-database';
import { NO_SNAPSHOTS, type RecoveryReason, type SnapshotInfo, type SnapshotStore } from '../../db/open';
import { restoreBytes, salvageBytes } from '../../db/salvage';
import { restoreSnapshot } from '../../db/snapshots';
import { saveBytes } from '../../lib/download';
import { Button, ErrorBox } from '../../ui';
import { formatBytes, formatWhen, recoveryCopy } from './recovery-copy';
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
  const newest = kept[0] ?? null;

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
        {copy.actions.includes('restore') && newest && (
          <Button
            variant="primary"
            className="min-h-11 w-full flex-col gap-0 py-2"
            disabled={busy}
            onClick={() =>
              run('Restore', async () => {
                // What is on the device now is kept first, so restoring the wrong copy is an undo and
                // not the end of everything entered since that copy was taken.
                await restoreSnapshot({
                  snapshots,
                  file: newest.file,
                  live: async () => bytes ?? (await salvageBytes().catch(() => null)),
                  restore: restoreBytes,
                });
                reopen();
              })
            }
          >
            <span className="block">Restore the last good copy</span>
            {/* What is actually being put back, so nobody presses this without knowing what they lose. */}
            <span className="mt-0.5 block text-xs font-normal opacity-80">
              From {formatWhen(newest.takenAt)} · {formatBytes(newest.bytes)}
            </span>
          </Button>
        )}
        {copy.actions.includes('export') && (
          <Button variant="secondary" className="min-h-11 w-full" disabled={busy} onClick={() => run('Export', onExport)}>
            Download a copy of my data
          </Button>
        )}
        {copy.actions.includes('retry') && (
          <Button variant={copy.actions.includes('restore') ? 'secondary' : 'primary'} className="min-h-11 w-full" disabled={busy} onClick={reopen}>
            Try again
          </Button>
        )}
      </div>

      {note && (
        <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">
          {note}
        </p>
      )}
      <div className="mt-3">
        <ErrorBox error={error} />
      </div>

      {newest && !copy.actions.includes('restore') && (
        <p className="mt-3 text-xs text-slate-500">The last copy we hold was taken on {formatWhen(newest.takenAt)}.</p>
      )}

      <details className="mt-6 text-xs text-slate-500">
        <summary className="cursor-pointer py-2">Details</summary>
        <p className="mt-1 break-words">{reason.kind}</p>
        <p className="mt-1 break-words whitespace-pre-wrap">{reason.detail}</p>
      </details>

      {copy.actions.includes('start-fresh') && (
        <div className="mt-6 border-t border-slate-200 pt-4">
          <Button variant="ghost" onClick={() => setFresh(true)} disabled={busy} className="px-0 text-xs font-normal text-red-700 underline underline-offset-2 hover:bg-transparent">
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
