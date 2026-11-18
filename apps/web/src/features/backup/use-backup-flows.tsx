import { isoDate, unzipStore, zipStore } from '@expanses/core';
import { allPhotoRows, LATEST_VERSION } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { type ChangeEvent, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { newerDatabaseVersion } from '../../db/newer-database';
import { NO_SNAPSHOTS, type SnapshotInfo, type SnapshotStore } from '../../db/open';
import { restoreSnapshot } from '../../db/snapshots';
import { RestoreCancelledError, sharingGate } from '../../db/restore-sharing';
import { saveBytes, savedWhere } from '../../lib/download';
import { holdPhotosOrRefuse } from '../../photos/hold-before-restore';
import { photos } from '../../photos/store';
import { useInvalidateAll } from '../../lib/queries';
import { formatWhen } from '../recovery/recovery-copy';
import { getLastBackupAt, isSqliteFile, setLastBackupAt } from './backupState';

/*
 * What the Backup page does, as one hook: the phone's Backup page and the Mac's Settings › Backup draw it each in
 * their own look, and both press exactly these handlers — one save, one restore with its safety copy and second
 * press, one photo zip each way. Nothing here was added for the Mac: it is the Backup page's own code, moved.
 */

export interface PendingRestore {
  bytes: Uint8Array;
  name: string;
  safetyName: string;
  /** Set when the bytes came from one of the app's own copies, so the store is asked for them afresh. */
  file?: string;
}

/** "1 photo", "12 photos" — said the same way by the button and by both sentences that report a result. */
export const photoWords = (count: number): string => `${count} photo${count === 1 ? '' : 's'}`;

export function useBackupFlows() {
  const { database, safety, ws, sync } = useApp();
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
  /*
   * The two real choosers, kept in the DOM behind the rows that name them. A row that opens a picker it does
   * not contain is a link to nowhere, and these are the inputs the file actually arrives on — the same
   * arrangement the import screen uses.
   */
  const sqliteInput = useRef<HTMLInputElement>(null);
  const zipInput = useRef<HTMLInputElement>(null);

  async function exportBackup(filename: string) {
    const bytes = await database.exportBytes();
    const to = await saveBytes(bytes, filename, 'application/vnd.sqlite3');
    await setLastBackupAt(database, new Date().toISOString());
    await invalidate();
    return to;
  }

  async function onExport() {
    setError(null);
    setDone(null);
    setBusy(true);
    try {
      const to = await exportBackup(`expanses-backup-${isoDate()}.sqlite3`);
      setDone(`Backup saved. ${savedWhere(to)}`);
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
      await saveBytes(zipStore(files), `expanses-photos-${isoDate()}.zip`, 'application/zip');
      setDone(`${photoWords(files.length)} saved.${unreadable ? ` ${photoWords(unreadable)} could not be read from this device.` : ''}`);
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
      if (!window.confirm(`Replace ALL data on this device with "${file.name}"?\n\nA safety copy of the current data downloads first.`)) return;
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
      if (!window.confirm(`Replace ALL data on this device with the copy from ${when}?\n\nA safety copy of the current data downloads first.`)) return;
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
    /*
     * The pictures are put beyond the sweep's reach before the data under them changes.
     *
     * A restore hands the app a database that may predate photos that are on this device right now, and
     * `onConfirmRestore` reloads the page the moment it lands — so `Layout.tsx`'s app-start sweep runs
     * against a database that has never heard of them and reads every one as an orphan. The row comes back
     * if the newer backup is restored again; the photograph does not. The safety copy this restore already
     * insisted on covers the data. This is the same insistence, for the one thing that has no second copy.
     */
    await holdPhotosOrRefuse();
    /*
     * One path whatever this open has. Without a store there is nowhere to keep a copy (the file downloaded a
     * moment ago stands behind the restore) but the bytes are still checked before anything is replaced.
     */
    const store = snapshots ?? NO_SNAPSHOTS;
    await restoreSnapshot({
      /*
       * A file from the user's downloads is not in the store, so the bytes already read and checked are
       * handed over through a `read` that answers with them. One of the app's own copies is read from the
       * store by name, as the recovery screen reads it.
       */
      snapshots: restore.file && snapshots ? snapshots : ({ ...store, read: async () => restore.bytes } satisfies SnapshotStore),
      file: restore.file ?? restore.name,
      source: restore.file ? 'Backup page, a kept copy' : 'Backup page, a backup file',
      live: () => database.exportBytes(),
      // Sharing stops first and waits for a run in flight, so nothing pulls into the restored rows before the reload
      // checks them against the share records (sharing resilience §6.7, review R1).
      restore: (bytes) => sync.whileReplacing(() => database.importBytes(bytes)),
      checkSharing: sharingGate(),
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
      if (e instanceof RestoreCancelledError) {
        // Called off at the sharing warning: the data here is as it was.
        setPending(null);
        setBusy(false);
        return;
      }
      const version = newerDatabaseVersion(e);
      if (version === null) {
        setError(e);
      } else {
        setPending(null);
        setError(
          new Error(
            `This data was made by a newer version of Expanses. Nothing on this device was changed: that copy was written by update ${version}, and this app knows up to update ${LATEST_VERSION}. Update Expanses, then choose that file again — the data here stays exactly as it is until then.`,
          ),
        );
      }
      setBusy(false);
    }
  }

  return {
    photoIndex,
    last,
    kept,
    error,
    busy,
    done,
    pending,
    /** Busy, or a restore waiting for its second press: every other action waits. */
    blocked: busy || !!pending,
    onExport,
    onDownloadPhotos,
    onChooseCopy,
    onConfirmRestore,
    /** Cancel on a waiting restore: nothing was replaced. */
    cancelRestore: () => setPending(null),
    /** Opens the real file chooser for a backup file; what is chosen arrives at `onChooseFile` (`BackupFileInputs`). */
    chooseBackupFile: () => sqliteInput.current?.click(),
    /** Opens the real file chooser for a photos zip. */
    choosePhotoZip: () => zipInput.current?.click(),
    inputs: { sqliteInput, zipInput, onChooseFile, onChoosePhotoZip },
  };
}

export type BackupFlows = ReturnType<typeof useBackupFlows>;

/**
 * The two real choosers, out of the way at the foot of the page: every row above opens the one that names
 * it, and what it opens is a real `<input type="file">` — so the file the app reads is the file the user
 * chose, and a test can hand one over without a thumb.
 */
export function BackupFileInputs({ flows }: { flows: BackupFlows }) {
  const { sqliteInput, zipInput, onChooseFile, onChoosePhotoZip } = flows.inputs;
  return (
    <>
      <input
        ref={sqliteInput}
        type="file"
        accept=".sqlite3,.db,application/vnd.sqlite3,application/octet-stream"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => void onChooseFile(e)}
        disabled={flows.blocked}
      />
      <input
        ref={zipInput}
        type="file"
        accept=".zip,application/zip"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => void onChoosePhotoZip(e)}
        disabled={flows.blocked}
      />
    </>
  );
}
