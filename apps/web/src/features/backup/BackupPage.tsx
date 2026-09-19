import { isoDate } from '@expanses/core';
import { LATEST_VERSION } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { type ChangeEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { refusedCopy } from '../../db/newer-database';
import type { SnapshotInfo } from '../../db/open';
import { saveBytes } from '../../lib/download';
import { useInvalidateAll } from '../../lib/queries';
import { Button, Card, ErrorBox, PageHeader } from '../../ui';
import { formatBytes, formatWhen } from '../recovery/recovery-copy';
import { copyReasonWords, daysSince, getLastBackupAt, isSqliteFile, setLastBackupAt } from './backupState';

interface PendingRestore {
  bytes: Uint8Array;
  name: string;
  safetyName: string;
}

export function BackupPage() {
  const { database, safety } = useApp();
  const invalidate = useInvalidateAll();
  const last = useQuery({ queryKey: ['last-backup'], queryFn: () => getLastBackupAt(database) });
  const snapshots = safety?.snapshots;
  const kept = useQuery({
    queryKey: ['safety-copies'],
    enabled: !!snapshots,
    queryFn: async () => [...(await snapshots!.list())].sort((a, b) => b.takenAt.localeCompare(a.takenAt)),
  });
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

  /**
   * Putting back one of the app's own copies goes through exactly the same two steps as a file from the
   * user's downloads: a safety copy of what is here now, then a second, deliberate press. The copies are
   * the app's, but the data they replace is theirs.
   */
  async function onChooseCopy(copy: SnapshotInfo) {
    if (!snapshots) return;
    setError(null);
    setDone(null);
    try {
      const when = formatWhen(copy.takenAt);
      if (!window.confirm(`Replace ALL data on this device with the copy from ${when}?\n\nA safety copy of your current data downloads first.`)) return;
      setBusy(true);
      const bytes = await snapshots.read(copy.file);
      if (!isSqliteFile(bytes)) throw new Error('That copy is no longer readable on this device.');
      const safetyName = `expanses-before-restore-${isoDate()}.sqlite3`;
      await exportBackup(safetyName);
      setPending({ bytes, name: `the copy from ${when}`, safetyName });
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
        <p className="text-xs text-slate-500">A backup made on any device or browser will do: it is the same file everywhere.</p>
        {done && <p className="text-sm text-emerald-700">{done}</p>}
        <ErrorBox error={error} />
      </Card>

      {/* Directly under the action that raised it: the second press must never be somewhere the user has to go looking for. */}
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

      <Card className="space-y-3">
        <h2 className="font-semibold">Safety copies on this device</h2>
        <p className="text-sm text-slate-700">
          Expanses keeps a copy of your data before every update and once on each day you open it, so a bad update or the wrong restore can be undone. They sit in this app's own storage on this device, which means they are <strong>not a backup</strong>: anything that loses your data loses them with it. Only a file you have downloaded and kept somewhere else is a backup.
        </p>
        {kept.data?.length ? (
          <ul className="divide-y divide-slate-200 text-sm">
            {kept.data.map((copy) => (
              <li key={copy.file} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="block text-slate-900">{formatWhen(copy.takenAt)}</span>
                  <span className="block text-xs text-slate-500">
                    {copyReasonWords(copy.reason)} · {formatBytes(copy.bytes)}
                  </span>
                </span>
                <Button variant="secondary" className="min-h-11" disabled={busy || !!pending} onClick={() => void onChooseCopy(copy)}>
                  Restore this copy
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">No copies on this device yet. One is taken the first time you open Expanses each day, and before any update to your data.</p>
        )}
      </Card>

      <Card className="space-y-3">
        <h2 className="font-semibold">Backups and your iPhone</h2>
        <p className="text-sm text-slate-700">
          When Expanses is installed as an app, your data sits in the app's own container, which iCloud and Finder back up with the rest of the phone. Deleting the app deletes that copy too.
        </p>
        <p className="text-sm text-slate-600">
          So keep downloading a backup of your own. A file you hold is the only copy that survives a lost phone, a deleted app, and a restore that goes wrong — and it opens on any device you install Expanses on.
        </p>
      </Card>
    </div>
  );
}
