import { readSafetyFile, writeSafetyFile } from '../db/snapshots';
import { SYNC_LOG_FILE, type SyncLogStore } from './sync-log';

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
