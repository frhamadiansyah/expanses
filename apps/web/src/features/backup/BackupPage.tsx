import { isoDate, unzipStore, zipStore } from '@expanses/core';
import { allPhotoRows, LATEST_VERSION } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { type ChangeEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { newerDatabaseVersion } from '../../db/newer-database';
import type { SnapshotInfo, SnapshotStore } from '../../db/open';
import { restoreSnapshot } from '../../db/snapshots';
import { saveBytes } from '../../lib/download';
import { photos } from '../../photos/store';
import { useInvalidateAll } from '../../lib/queries';
import { Button, Card, ErrorBox, PageHeader } from '../../ui';
import { formatBytes, formatWhen } from '../recovery/recovery-copy';
import { copyReasonWords, daysSince, getLastBackupAt, isSqliteFile, setLastBackupAt } from './backupState';

interface PendingRestore {
  bytes: Uint8Array;
  name: string;
  safetyName: string;
  /** Set when the bytes came from one of the app's own copies, so the store is asked for them afresh. */
  file?: string;
}

/** "1 photo", "12 photos" — said the same way by the button and by both sentences that report a result. */
const photoWords = (count: number): string => `${count} photo${count === 1 ? '' : 's'}`;

export function BackupPage() {
  const { database, safety, ws } = useApp();
  const invalidate = useInvalidateAll();
  /*
   * The pictures are not in the sqlite backup: that file holds the rows, and a row only names a file. So they
   * get a download of their own, and the button is only worth showing once there is something in it.
   */
  const photoIndex = useQuery({ queryKey: ['photo-rows', ws.workspaceId], queryFn: () => allPhotoRows(database, ws) });
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

  /**
   * The pictures, zipped straight from this device's storage — stored, never compressed, so the zip needs no
   * compression library and any ordinary zip tool opens it. Each entry is named by the row that names it, which
   * is what lets the restore below put a picture back where a transaction is still expecting it.
   */
  async function onDownloadPhotos() {
    setError(null);
    setDone(null);
    setBusy(true);
    try {
      const rows = await allPhotoRows(database, ws);
      const files: { name: string; bytes: Uint8Array }[] = [];
      let unreadable = 0;
      for (const row of rows) {
        const bytes = await photos.readPhotoBytes(row.fileName);
        // A row whose file is gone is worth saying out loud rather than quietly shipping a short zip.
        if (bytes) files.push({ name: row.fileName, bytes });
        else unreadable += 1;
      }
      if (!files.length) throw new Error('None of the photos could be read from this device.');
      saveBytes(zipStore(files), `expanses-photos-${isoDate()}.zip`, 'application/zip');
      setDone(`${photoWords(files.length)} downloaded.${unreadable ? ` ${photoWords(unreadable)} could not be read from this device.` : ''}`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Putting pictures back. Unlike the database restore this replaces nothing and needs no second press: a file
   * already on this device is left exactly as it is, and an entry no row names is skipped — a zip cannot decide
   * what this device's transactions point at, and writing a name from a file nobody here chose is how an
   * archive gets to put bytes where it likes. `unzipStore` refuses an entry whose bytes no longer match the
   * checksum recorded for it, so a damaged archive stops here rather than half-restoring.
   */
  async function onChoosePhotoZip(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError(null);
    setDone(null);
    setBusy(true);
    try {
      const entries = unzipStore(new Uint8Array(await file.arrayBuffer()));
      const named = new Set((await allPhotoRows(database, ws)).map((row) => row.fileName));
      let restored = 0;
      let already = 0;
      let unknown = 0;
      for (const entry of entries) {
        if (!named.has(entry.name)) {
          unknown += 1;
          continue;
        }
        if (await photos.putPhotoBytes(entry.name, entry.bytes)) restored += 1;
        else already += 1;
      }
      setDone(`${photoWords(restored)} restored · ${already} already here${unknown ? ` · ${unknown} not named by any transaction on this device` : ''}`);
      await invalidate();
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
      setPending({ bytes, name: `the copy from ${when}`, safetyName, file: copy.file });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Replacing the live data with `restore`, keeping what is here now first.
   *
   * The same call the recovery screen makes, and for the same reason: the download taken before the second
   * press is a file the user has to go and find again, while a `before-restore` copy in the app's own
   * storage turns the wrong restore into an undo they can press. This is the path a working app actually
   * takes — the recovery screen is the rare one — so it is the path that most needs the copy.
   */
  async function putBack(restore: PendingRestore) {
    if (!snapshots) {
      // This open has no store to keep a copy in. The restore the user asked for still happens; the file
      // downloaded a moment ago is what stands behind it.
      await database.importBytes(restore.bytes);
      return;
    }
    await restoreSnapshot({
      /*
       * A file from the user's downloads is not in the store, so the bytes already read and checked are
       * handed over through a `read` that answers with them. One of the app's own copies is read from the
       * store by name, as the recovery screen reads it.
       */
      snapshots: restore.file ? snapshots : ({ ...snapshots, read: async () => restore.bytes } satisfies SnapshotStore),
      file: restore.file ?? restore.name,
      live: () => database.exportBytes(),
      restore: (bytes) => database.importBytes(bytes),
    });
  }

  async function onConfirmRestore() {
    if (!pending) return;
    setError(null);
    setBusy(true);
    try {
      await putBack(pending);
      window.location.reload();
    } catch (e) {
      /*
       * A file from a newer build is refused before it is adopted, so this device's data is exactly where
       * it was. The waiting restore is dropped with it — pressing the same button again cannot succeed
       * until the app is updated — so the sentence says what is actually left to do rather than "try it
       * again", which from here would mean choosing the file and downloading the safety copy all over.
       */
      const version = newerDatabaseVersion(e);
      if (version === null) {
        setError(e);
      } else {
        setPending(null);
        setError(
          new Error(
            `This data was made by a newer version of Expanses. Nothing on this device was changed: that copy was written by update ${version}, and this app knows up to update ${LATEST_VERSION}. Update Expanses, then choose that file again — your data here stays exactly as it is until you do.`,
          ),
        );
      }
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
        <div className="flex flex-wrap gap-2">
          {!!photoIndex.data?.length && (
            <Button variant="secondary" onClick={() => void onDownloadPhotos()} disabled={busy || !!pending}>
              Download photos ({photoIndex.data.length})
            </Button>
          )}
          <label className="inline-flex cursor-pointer items-center rounded-lg bg-white px-3 py-2 text-sm font-medium ring-1 ring-slate-300 hover:bg-slate-100">
            Restore photos…
            <input type="file" accept=".zip,application/zip" className="sr-only" onChange={(e) => void onChoosePhotoZip(e)} disabled={busy || !!pending} />
          </label>
        </div>
        <p className="text-xs text-slate-500">Photos live beside the database on this device. The backup file holds your figures; this zip holds the pictures.</p>
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
        {/* Spec §8.2: until the device check has actually been run on a phone, nothing here may say a
            device backup covers this data. What is true today is said instead. */}
        <p className="text-sm text-slate-700">
          Expanses runs in your browser today, so an iPhone backup does not carry your data with it: an iCloud or Finder backup does not include a website's storage, and Safari can clear it after a week or so without opening the app. When Expanses ships as an installed app we will check on a real phone what a device backup covers, and say so here then.
        </p>
        <p className="text-sm text-slate-600">
          So keep downloading a backup of your own. A file you hold is the only copy that survives a lost phone, a deleted app, and a restore that goes wrong — and it opens on any device you install Expanses on.
        </p>
      </Card>
    </div>
  );
}
