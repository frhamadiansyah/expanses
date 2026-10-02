import { App as Shell } from '@capacitor/app';
import { type Database, dataCounts } from '@expanses/db';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { Safety } from '../../../db/open';
import { restoreSnapshot } from '../../../db/snapshots';
import { holdPhotosOrRefuse } from '../../../photos/hold-before-restore';
import { photos } from '../../../photos/store';
import { isSqliteFile } from '../backupState';
import { hasData, iCloudSettings } from './data';
import type { CopyContents } from './envelope';
import { hasICloud, ICloudBackup } from './plugin';
import { backUpIfDue, backUpNow, type CopySource, openCopy } from './service';

/** The query every iCloud row reads: whether iCloud is there, and the copies in it. */
export const ICLOUD_QUERY = ['icloud-copies'] as const;

/*
 * "Something big just happened, take a copy": set by an import and by a restore, and kept on the device rather than
 * in the data, because a restore replaces the data and the page reloads before the copy can be taken.
 */
const BIG_CHANGE_KEY = 'cicis.icloud-backup.big-change';

function bigChangePending(): boolean {
  try {
    return localStorage.getItem(BIG_CHANGE_KEY) === '1';
  } catch {
    return false;
  }
}

function setBigChange(pending: boolean): void {
  try {
    if (pending) localStorage.setItem(BIG_CHANGE_KEY, '1');
    else localStorage.removeItem(BIG_CHANGE_KEY);
  } catch {
    // Without storage the daily copy still runs; only the extra one after a big change is lost.
  }
}

/** This device's data, as a copy reads it: every workspace, every photo on the device. */
export function copySource(database: Database): CopySource {
  return {
    database: () => database.exportBytes(),
    counts: () => dataCounts(database),
    photoNames: () => photos.listPhotoFiles(),
    readPhoto: (name) => photos.readPhotoBytes(name).catch(() => null),
  };
}

let running: Promise<boolean> | null = null;

/**
 * Takes the copy if one is due. One at a time: an open and a return to the app a second later ask together, and two
 * copies of the same data a second apart is a wasted upload.
 */
export function runICloudBackup(database: Database, options: { force?: boolean } = {}): Promise<boolean> {
  if (!hasICloud()) return Promise.resolve(false);
  if (running) return running;
  running = (async () => {
    try {
      const settings = await iCloudSettings(database);
      const source = copySource(database);
      if (options.force) {
        await backUpNow(ICloudBackup, source, { withPhotos: settings.withPhotos });
        setBigChange(false);
        return true;
      }
      const taken = await backUpIfDue(ICloudBackup, source, {
        enabled: settings.enabled,
        withPhotos: settings.withPhotos,
        hasData: await hasData(database),
        bigChange: bigChangePending(),
      });
      if (taken) setBigChange(false);
      return taken;
    } finally {
      running = null;
    }
  })();
  return running;
}

/** After an import: take a copy now rather than tomorrow, if the switch is on. */
export function afterBigChange(database: Database): void {
  if (!hasICloud()) return;
  setBigChange(true);
  void runICloudBackup(database).catch((error: unknown) => console.warn('The iCloud copy after a big change was not taken', error));
}

/**
 * The daily copy: once when the app opens, and again each time it comes back to the front, which on a phone is how
 * an app left open for days still gets its copy. Failures are quiet here — the Backup page shows the last copy, and
 * that is where a missing one is noticed — and retried at the next return.
 */
export function useICloudBackupAtStart(database: Database | undefined): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!database || !hasICloud()) return;
    const run = () =>
      void runICloudBackup(database)
        .then(async (taken) => {
          if (taken) await queryClient.invalidateQueries({ queryKey: ICLOUD_QUERY });
        })
        .catch((error: unknown) => console.warn('The iCloud copy was not taken', error));
    // After the first screen has drawn: a copy reads the whole database, and the first paint never waits for it.
    const first = window.setTimeout(run, 3000);
    const handle = Shell.addListener('resume', run);
    return () => {
      window.clearTimeout(first);
      void handle.then((listener) => listener.remove());
    };
  }, [database, queryClient]);
}

/**
 * Replaces this device's data with an iCloud copy that has already been opened.
 *
 * The same steps as every other restore in the app: the photos on this device are held out of the start-up sweep's
 * reach, the data being replaced is kept as a `before-restore` safety copy, then the copy's data goes in. Its photos
 * are put back beside it — a photo already here is left as it is. A copy is then taken of the restored data at the
 * next open, so iCloud's newest copy is what this device now holds.
 *
 * The caller reloads the page once this resolves.
 */
export async function restoreContents(contents: CopyContents, app: { database: Database; safety?: Safety }): Promise<void> {
  if (!isSqliteFile(contents.database)) throw new Error('That iCloud copy holds no data cicis can read.');
  await holdPhotosOrRefuse();
  if (app.safety) {
    const snapshots = app.safety.snapshots;
    await restoreSnapshot({
      snapshots: { ...snapshots, read: async () => contents.database },
      file: 'icloud',
      live: () => app.database.exportBytes(),
      restore: (bytes) => app.database.importBytes(bytes),
    });
  } else {
    await app.database.importBytes(contents.database);
  }
  for (const photo of contents.photos) {
    try {
      await photos.putPhotoBytes(photo.name, photo.bytes);
    } catch (error) {
      console.warn('A photo from the iCloud copy could not be put back', photo.name, error);
    }
  }
  setBigChange(true);
}

/** Opens the named copy and restores it. */
export async function restoreFromICloud(name: string, app: { database: Database; safety?: Safety }): Promise<void> {
  await restoreContents(await openCopy(ICloudBackup, name), app);
}
