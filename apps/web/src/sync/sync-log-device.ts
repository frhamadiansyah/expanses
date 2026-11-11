import type { SnapshotReason } from '../db/snapshot-policy';
import { readSafetyFile, type SnapshotSpaceError, writeSafetyFile } from '../db/snapshots';
import { SYNC_LOG_FILE, SyncLog, type SyncLogStore } from './sync-log';

/**
 * The sync log on this device: `expanses-safety/sync-log.json`, read and written the way `last-failure.json` is
 * (src/features/recovery/failure-record.ts). The snapshot store skips any file in that folder whose name is not a
 * copy's, so this one is never taken for a copy, listed as one or pruned.
 */
export function deviceSyncLogStore(): SyncLogStore {
  return {
    read: () => readSafetyFile(SYNC_LOG_FILE),
    write: (bytes) => writeSafetyFile(SYNC_LOG_FILE, bytes),
  };
}

let shared: SyncLog | null = null;

/**
 * The one log over the device's file for this page. One, because each `SyncLog` holds the entries in memory and
 * writes them whole: two over the same file would each write over what the other added.
 */
export function deviceSyncLog(): SyncLog {
  shared ??= new SyncLog(deviceSyncLogStore());
  return shared;
}

/**
 * A safety copy skipped for want of room, in the sync log as a device-wide entry, so Share › Details shows it on any
 * workspace. Given to the snapshot store as `onSkipped`. Never throws, never waited on.
 */
export function noteSkippedCopy(reason: SnapshotReason, error: SnapshotSpaceError): void {
  void deviceSyncLog()
    .record({ op: 'copy', error: Object.assign(new Error(`No ${reason} copy was taken. ${error.message}`), { name: error.name }) })
    .catch(() => undefined);
}
