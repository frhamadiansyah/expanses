import {
  checkDatabase,
  checkStructure,
  type Database,
  databaseVersion,
  futureVersions,
  migrate,
  MIGRATIONS,
  type Migration,
  pendingMigrations,
} from '@expanses/db';
import { type AppDb, openAppDb } from './bootstrap';

export type RecoveryKind = 'cannot-open' | 'unreadable' | 'corrupt' | 'newer-database' | 'migration-failed' | 'verify-failed' | 'locked';

export interface RecoveryReason {
  kind: RecoveryKind;
  /** One sentence, in the user's words. */
  headline: string;
  /** What happened, for "Details" and a bug report. Never shown above the fold. */
  detail: string;
  /** Whether the bytes can still be handed to the user. */
  exportable: boolean;
  /** Whether the database was put back the way it was before an update. */
  rolledBack?: boolean;
}

export type OpenStage =
  | { stage: 'opening' | 'snapshotting' | 'checking' }
  | { stage: 'migrating'; done: number; total: number; name: string };

/** Why a copy was taken. Only a copy taken for one of these reasons is ever written. */
export type SnapshotReason = 'before-migration' | 'before-restore' | 'before-start-fresh';

/** One copy in the store, as the store describes it. Task 5 writes the store that produces these. */
export interface SnapshotInfo {
  /** The file name inside the app's own storage. The handle `read` takes. */
  file: string;
  reason: SnapshotReason;
  /** The schema version the bytes were taken at. */
  schemaVersion: number;
  /** Size of the copy in bytes, so the screen can say how big the last good copy is. */
  size: number;
  /** When the copy was taken, ISO. */
  takenAt: string;
}

/**
 * The copies kept beside the live database. Task 5 implements it over OPFS; until then the only
 * store is `NO_SNAPSHOTS`. `block`/`unblock` record a version that must not be tried again, so an
 * update that failed once does not fail the same way on every reload.
 */
export interface SnapshotStore {
  list(): Promise<SnapshotInfo[]>;
  write(bytes: Uint8Array, reason: SnapshotReason, schemaVersion: number): Promise<SnapshotInfo>;
  read(file: string): Promise<Uint8Array>;
  blockedVersion(): Promise<number | null>;
  block(version: number): Promise<void>;
  unblock(): Promise<void>;
}

const NOTHING_KEPT = 'This build keeps no copies of your data yet.';

/** A store that keeps nothing — the behaviour before Task 6 lands, and what the unit tests use. */
export const NO_SNAPSHOTS: SnapshotStore = {
  list: async () => [],
  // Loud rather than silent: a caller that thinks it took a copy must not be told it did.
  write: async () => {
    throw new Error(NOTHING_KEPT);
  },
  read: async () => {
    throw new Error(NOTHING_KEPT);
  },
  blockedVersion: async () => null,
  block: async () => undefined,
  unblock: async () => undefined,
};

export interface OpenDeps {
  database: Database;
  migrations?: Migration[];
  snapshots: SnapshotStore;
  onStage: (stage: OpenStage) => void;
}

export type OpenResult = { ok: true; app: AppDb; applied: number[] } | { ok: false; reason: RecoveryReason };

export const say = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// Said the same way wherever the file itself is the problem: never "corrupt" without "still on this device".
const corrupt = (detail: string): RecoveryReason => ({
  kind: 'corrupt',
  headline: 'Your data is still on this device, but we could not read it this time.',
  detail,
  exportable: true,
});

/**
 * The copy taken before an update, so a failed one can be undone. Task 6 gives this a body; until
 * then no copy exists and every caller must cope with `null`.
 */
async function takeSnapshot(_deps: { database: Database; snapshots: SnapshotStore; version: number; onStage: (stage: OpenStage) => void }): Promise<SnapshotInfo | null> {
  return null;
}

/**
 * Undoing a failed update from the copy taken before it. Task 7 gives this a body; until then there
 * is no copy to go back to, so it only names what went wrong and says plainly that nothing was undone.
 */
async function rollback(deps: {
  snapshots: SnapshotStore;
  database: Database;
  restore: SnapshotInfo | null;
  kind: RecoveryKind;
  headline: string;
  detail: string;
  version: number;
}): Promise<OpenResult> {
  return { ok: false, reason: { kind: deps.kind, headline: deps.headline, detail: deps.detail, exportable: true, rolledBack: false } };
}

/**
 * Opening in named stages, so that every way this can go wrong ends in a screen with buttons rather
 * than a thrown error. Nothing before `migrate` writes a byte: the version is read, the future is
 * refused, and the file is checked, all read-only.
 */
export async function openSafely({ database, migrations = MIGRATIONS, snapshots, onStage }: OpenDeps): Promise<OpenResult> {
  onStage({ stage: 'opening' });

  let version: number;
  try {
    version = await databaseVersion(database);
  } catch (error) {
    /*
     * A malformed file usually announces itself here, on the first read, rather than waiting for the
     * check below — so ask SQLite what it thinks before naming this. checkStructure never throws, and
     * "corrupt" is the kind whose screen says the data is still on the device; "unreadable" is kept
     * for a file that reads as sound but would not answer.
     */
    const problems = await checkStructure(database);
    if (problems.length) return { ok: false, reason: corrupt(problems.map((p) => p.detail).join('; ')) };
    return { ok: false, reason: { kind: 'unreadable', headline: 'We could not read your data this time.', detail: say(error), exportable: true } };
  }

  const future = await futureVersions(database, migrations);
  if (future.length) {
    return {
      ok: false,
      reason: {
        kind: 'newer-database',
        headline: 'This data was made by a newer version of Expanses.',
        detail: `Your data: update ${Math.max(...future)} · This app: update ${Math.max(...migrations.map((m) => m.version))}`,
        exportable: true,
      },
    };
  }

  // An existing file is checked before it is touched; a brand-new one has nothing to check.
  if (version > 0) {
    const problems = await checkStructure(database);
    if (problems.length) return { ok: false, reason: corrupt(problems.map((p) => p.detail).join('; ')) };
  }

  const pending = await pendingMigrations(database, migrations);
  let applied: number[] = [];
  if (pending.length) {
    const restore = await takeSnapshot({ database, snapshots, version, onStage });
    try {
      applied = await migrate(database, migrations, {
        onProgress: (done, total, name) => onStage({ stage: 'migrating', done, total, name }),
      });
    } catch (error) {
      return rollback({
        snapshots,
        database,
        restore,
        kind: 'migration-failed',
        headline: 'The update could not be finished.',
        detail: say(error),
        version: pending[0]!.version,
      });
    }
  }

  onStage({ stage: 'checking' });
  const problems = await checkDatabase(database, { deep: applied.length > 0 });
  if (problems.length) {
    return rollback({
      snapshots,
      database,
      restore: null,
      kind: 'verify-failed',
      headline: 'We checked your data after the update and something did not add up.',
      detail: problems.map((p) => `${p.kind}: ${p.detail}`).join('; '),
      version: applied[0] ?? 0,
    });
  }

  try {
    return { ok: true, app: await openAppDb(database), applied };
  } catch (error) {
    return { ok: false, reason: { kind: 'cannot-open', headline: 'We could not finish opening your data.', detail: say(error), exportable: true } };
  }
}
