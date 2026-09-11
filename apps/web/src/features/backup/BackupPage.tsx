import { isoDate } from '@expanses/core';
import { useQuery } from '@tanstack/react-query';
import { type ChangeEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { saveBytes } from '../../lib/download';
import { useInvalidateAll } from '../../lib/queries';
import { Button, Card, ErrorBox, PageHeader } from '../../ui';
import { daysSince, getLastBackupAt, isSqliteFile, setLastBackupAt } from './backupState';

export function BackupPage() {
  const { database } = useApp();
  const invalidate = useInvalidateAll();
  const last = useQuery({ queryKey: ['last-backup'], queryFn: () => getLastBackupAt(database) });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  async function exportBackup(filename = `expanses-backup-${isoDate()}.sqlite3`) {
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
      await exportBackup();
      setDone('Backup downloaded. Keep it somewhere private.');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function onImport(event: ChangeEvent<HTMLInputElement>) {
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
      await exportBackup(`expanses-before-restore-${isoDate()}.sqlite3`);
      await database.importBytes(bytes);
      window.location.reload();
    } catch (e) {
      setError(e);
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
          {last.data ? `Last backup ${daysSince(last.data) === 0 ? 'today' : `${daysSince(last.data)} days ago`}.` : 'No backup yet.'}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void onExport()} disabled={busy}>
            Download backup
          </Button>
          <label className="inline-flex cursor-pointer items-center rounded-lg bg-white px-3 py-2 text-sm font-medium ring-1 ring-slate-300 hover:bg-slate-100">
            Restore from file…
            <input type="file" accept=".sqlite3,.db,application/vnd.sqlite3,application/octet-stream" className="sr-only" onChange={(e) => void onImport(e)} disabled={busy} />
          </label>
        </div>
        {done && <p className="text-sm text-emerald-700">{done}</p>}
        <ErrorBox error={error} />
      </Card>
    </div>
  );
}
