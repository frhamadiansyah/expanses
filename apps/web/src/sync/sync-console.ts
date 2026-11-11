import { type Database, sharedBookRows, sharingDiagnostics } from '@expanses/db';
import { buildName } from '../features/recovery/failure-record';
import { collectSyncDetails, syncDetailsText } from '../features/sharing/sync-details';
import type { SyncLogEntry } from './sync-log';
import type { SyncService } from './sync-service';

/*
 * `window.__expansesSync`: the sharing tables and the sync log from Safari's Web Inspector, on a phone on a cable
 * (capacitor.config.ts turns inspection on for TestFlight builds). Reads only — nothing here writes, syncs or makes
 * keys — and ids, roles, states and counts only: no names, amounts, descriptions or keys.
 *
 * Installed in every build, since the TestFlight build is the one that needs it; without an inspectable web view
 * nobody can reach it. Remove together with `webContentsDebuggingEnabled` before an App Store release.
 */

type Diagnostics = Awaited<ReturnType<typeof sharingDiagnostics>>;

export interface SyncConsole {
  /** Every `shared_books` row (workspaces, events, net-worth group logs). */
  sharedBooks: () => ReturnType<typeof sharedBookRows>;
  /** Members of one book, or of every book with a row: ids and roles. */
  bookMembers: (bookId?: string) => Promise<({ bookId: string } & Diagnostics['members'][number])[]>;
  /** Devices of one book, or of every book with a row: ids only. */
  bookDevices: (bookId?: string) => Promise<({ bookId: string } & Diagnostics['devices'][number])[]>;
  outboxCount: (bookId?: string) => Promise<number>;
  cursor: (bookId: string) => Promise<number | null>;
  /** The sync log, newest first. */
  log: () => Promise<SyncLogEntry[]>;
  /** The Share › Details text, as Copy details copies it. */
  sharingDetail: (bookId: string) => Promise<string>;
  /** The same bookkeeping as an object. */
  sharingDiagnostics: (bookId: string) => Promise<Diagnostics>;
}

export function syncConsole(database: Database, sync: SyncService): SyncConsole {
  const books = async (bookId?: string) => (bookId !== undefined ? [bookId] : (await sharedBookRows(database)).map((row) => row.bookId));
  const each = async <T>(bookId: string | undefined, pick: (diag: Diagnostics) => T[]) =>
    (await Promise.all((await books(bookId)).map(async (id) => pick(await sharingDiagnostics(database, id)).map((row) => ({ bookId: id, ...row }))))).flat();
  return {
    sharedBooks: () => sharedBookRows(database),
    bookMembers: (bookId) => each(bookId, (diag) => diag.members),
    bookDevices: (bookId) => each(bookId, (diag) => diag.devices),
    outboxCount: async (bookId) => (await Promise.all((await books(bookId)).map(async (id) => (await sharingDiagnostics(database, id)).outbox))).reduce((sum, n) => sum + n, 0),
    cursor: async (bookId) => (await sharingDiagnostics(database, bookId)).cursor,
    log: () => sync.log.entries(),
    sharingDetail: async (bookId) => syncDetailsText(await collectSyncDetails({ database, sync, bookId, build: await buildName().catch(() => null) })),
    sharingDiagnostics: (bookId) => sharingDiagnostics(database, bookId),
  };
}

/** Puts the helper on `window` once the database is open. */
export function installSyncConsole(database: Database, sync: SyncService): void {
  if (typeof window === 'undefined') return;
  (window as unknown as { __expansesSync?: SyncConsole }).__expansesSync = syncConsole(database, sync);
}
