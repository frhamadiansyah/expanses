import { useState } from 'react';
import { Sheet } from '../../app/Sheet';
import type { SnapshotInfo } from '../../db/open';
import { wipeEverything } from '../../db/salvage';
import { Button, ErrorBox } from '../../ui';
import { formatBytes, formatWhen } from './recovery-copy';

/**
 * Starting again, which is the one action on the recovery screen that cannot be undone.
 *
 * It takes two presses on purpose. The first says exactly what is about to go — how big the data on this
 * device is, and when each kept copy was taken — and the red button stays disabled until the user has
 * either downloaded a backup here or said they already have one. Nobody loses a year of records to one tap.
 */
export function StartFreshDialog({
  sizeOnDevice,
  snapshots,
  onExport,
  onClose,
}: {
  /** Size of the database on this device, or null when it could not be read. */
  sizeOnDevice: number | null;
  snapshots: SnapshotInfo[];
  /** Downloads the data as it is now. Resolves when the file has been handed to the browser. */
  onExport: () => Promise<void>;
  onClose: () => void;
}) {
  const [exported, setExported] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function downloadFirst() {
    setError(null);
    setBusy(true);
    try {
      await onExport();
      setExported(true);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function deleteEverything() {
    setError(null);
    setBusy(true);
    try {
      await wipeEverything();
      window.location.href = window.location.pathname;
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Sheet title="Start fresh" onClose={onClose}>
      <div className="space-y-3 text-sm text-slate-700">
        <p>This removes everything Expanses keeps on this device and opens an empty app. It cannot be undone.</p>
        <ul className="list-disc space-y-1 rounded-xl bg-slate-50 py-3 pr-3 pl-8 text-slate-700">
          <li>Your data on this device{sizeOnDevice !== null && <span className="text-slate-500"> — {formatBytes(sizeOnDevice)}</span>}</li>
          {snapshots.length === 0 ? (
            <li>No kept copies on this device</li>
          ) : (
            snapshots.map((snapshot) => (
              <li key={snapshot.file}>
                A copy from {formatWhen(snapshot.takenAt)} <span className="text-slate-500">— {formatBytes(snapshot.size)}</span>
              </li>
            ))
          )}
        </ul>
        <p>Backups you have already downloaded are files on your computer or phone. They are not touched.</p>

        <Button variant="secondary" onClick={downloadFirst} disabled={busy} className="min-h-11 w-full">
          {exported ? 'Backup downloaded' : 'Download a backup first'}
        </Button>
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1 h-4 w-4" />
          <span>I already have a backup</span>
        </label>

        <ErrorBox error={error} />

        <Button variant="danger" onClick={deleteEverything} disabled={busy || !(exported || confirmed)} className="min-h-11 w-full">
          Delete everything on this device
        </Button>
        <Button variant="ghost" onClick={onClose} disabled={busy} className="min-h-11 w-full">
          Keep my data
        </Button>
      </div>
    </Sheet>
  );
}
