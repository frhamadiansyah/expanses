import { isoDate } from '@expanses/core';
import { LATEST_VERSION } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { type ChangeEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { refusedCopy } from '../../db/newer-database';
import { saveBytes } from '../../lib/download';
import { useInvalidateAll } from '../../lib/queries';
import { Button, Card, ErrorBox, PageHeader } from '../../ui';
import { daysSince, getLastBackupAt, isSqliteFile, setLastBackupAt } from './backupState';

interface PendingRestore {
  bytes: Uint8Array;
  name: string;
  safetyName: string;
}

export function BackupPage() {
  const { database } = useApp();
  const invalidate = useInvalidateAll();
  const last = useQuery({ queryKey: ['last-backup'], queryFn: () => getLastBackupAt(database) });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingRestore | null>(null);

  async function exportBackup(filename: string) {
    const bytes = await database.exportBytes();
    saveBytes(bytes, filename, 'application/vnd.sqlite3');
    await setLastBackupAt(database, new Date().toISOString());
    await invalidate();
  }

  async function onExport() {
    setError(null);
    setDone(null);
    setBusy(true);
    try {
      await exportBackup(`expanses-backup-${isoDate()}.sqlite3`);
      setDone('Backup downloaded. Check it is in your Downloads and keep it somewhere private.');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function onChooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError(null);
    setDone(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!isSqliteFile(bytes)) throw new Error('That file is not an Expanses backup.');
      if (!window.confirm(`Replace ALL data on this device with "${file.name}"?\n\nA safety copy of your current data downloads first.`)) return;
      setBusy(true);
      const safetyName = `expanses-before-restore-${isoDate()}.sqlite3`;
      await exportBackup(safetyName);
      setPending({ bytes, name: file.name, safetyName });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function onConfirmRestore() {
    if (!pending) return;
    setError(null);
    setBusy(true);
    try {
      await database.importBytes(pending.bytes);
      window.location.reload();
    } catch (e) {
      /*
       * A file from a newer build is refused before it is adopted, so this device's data is exactly where
       * it was. The waiting restore is dropped with it: pressing the same button again cannot succeed
       * until the app is updated, and while it waits it holds "Download backup" disabled — and export is
       * the one thing that must always stay within reach.
       */
      const refused = refusedCopy(e, LATEST_VERSION);
      if (refused) setPending(null);
      setError(refused ?? e);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Backup" />
      <Card className="space-y-3">
        <p className="text-sm text-slate-700">
          Your data lives only in this browser on this device. Nothing is sent to a server. If browser data is cleared, or Safari removes it after a week unused, it is gone — back up regularly.
        </p>
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Backup files are <strong>not encrypted</strong>. Anyone with the file can read your finances. Store it somewhere private.
        </p>
        <p className="text-sm text-slate-600">
          {last.data ? `Last backup downloaded ${daysSince(last.data) === 0 ? 'today' : `${daysSince(last.data)} days ago`}.` : 'No backup yet.'}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void onExport()} disabled={busy || !!pending}>
            Download backup
          </Button>
          <label className="inline-flex cursor-pointer items-center rounded-lg bg-white px-3 py-2 text-sm font-medium ring-1 ring-slate-300 hover:bg-slate-100">
            Restore from file…
            <input type="file" accept=".sqlite3,.db,application/vnd.sqlite3,application/octet-stream" className="sr-only" onChange={(e) => void onChooseFile(e)} disabled={busy || !!pending} />
          </label>
        </div>
        {done && <p className="text-sm text-emerald-700">{done}</p>}
        <ErrorBox error={error} />
      </Card>

      {pending && (
        <Card className="space-y-3 ring-2 ring-amber-500">
          <h2 className="font-semibold">Before you replace your data</h2>
          <p className="text-sm text-slate-700">
            Check that <strong>{pending.safetyName}</strong> is in your Downloads. It is your only copy of the data on this device right now. Continue only once it is there.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" onClick={() => void onConfirmRestore()} disabled={busy}>
              Replace my data with {pending.name}
            </Button>
            <Button variant="ghost" onClick={() => setPending(null)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
