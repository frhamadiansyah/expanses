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
import type { SnapshotInfo, SnapshotReason } from './snapshot-policy';

/** The types describing a safety copy live in `snapshot-policy.ts`; re-exported so every existing import from `./open` keeps working. */
export type { SnapshotInfo, SnapshotReason } from './snapshot-policy';

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

/**
 * The copies kept beside the live database, implemented over OPFS in `snapshots.ts`. `block`/`unblock`
 * record a version that must not be tried again, so an update that failed once does not fail the same
 * way on every reload.
 */
export interface SnapshotStore {
  list(): Promise<SnapshotInfo[]>;
  write(bytes: Uint8Array, reason: SnapshotReason, schemaVersion: number): Promise<SnapshotInfo>;
  read(file: string): Promise<Uint8Array>;
  blockedVersion(): Promise<number | null>;
  block(version: number): Promise<void>;
  unblock(): Promise<void>;
}

/**
 * Where an open app's copies go, and how to get the bytes for one. Carried on `AppDb` so the screen that
 * has just painted can take the day's copy without reaching back into the bootstrap.
 */
export interface Safety {
  snapshots: SnapshotStore;
  /** A file copy of the live database, taken between statements. */
  bytes: () => Promise<Uint8Array>;
}

const NOTHING_KEPT = 'This build keeps no copies of your data yet.';

/** A store that keeps nothing. Still the honest answer for a build or a test that keeps no copies. */
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
  /**
   * The bytes of the live database, for a safety copy. The worker's `snapshot` op when there is a worker
   * — it refuses mid-transaction rather than hand over a torn read — and a plain export otherwise, which
   * is what the Node-backed unit tests get.
   */
  snapshotBytes?: () => Promise<Uint8Array>;
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
 * The copy taken before an update, so a failed one can be undone.
 *
 * It is never a gate. If there is no room for it, or the engine will not hand the bytes over between
 * statements, the open carries on without a copy and says so — nobody is kept from their own data
 * because a safety net could not be strung. `skipped` is the sentence that then rides into the failure
 * text, so a user who does hit a broken update knows there is nothing to go back to.
 */
async function takeSnapshot(deps: {
  snapshots: SnapshotStore;
  bytes: () => Promise<Uint8Array>;
  version: number;
  onStage: (stage: OpenStage) => void;
}): Promise<{ snapshot: SnapshotInfo | null; skipped: string | null }> {
  // A file with no schema in it yet has nothing worth copying: a first open on a new device copies nothing.
  if (deps.version <= 0) return { snapshot: null, skipped: null };
  deps.onStage({ stage: 'snapshotting' });
  try {
    return { snapshot: await deps.snapshots.write(await deps.bytes(), 'before-migration', deps.version), skipped: null };
  } catch (error) {
    console.warn('No safety copy could be taken before the update', error);
    return { snapshot: null, skipped: say(error) };
  }
}

/**
 * Undoing a failed update from the copy taken before it. Layer 3 (the next task) gives this a body: it
 * already receives the copy this open took, and until it puts those bytes back it only names what went
 * wrong and says plainly that nothing was undone.
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
export async function openSafely({ database, migrations = MIGRATIONS, snapshots, onStage, snapshotBytes }: OpenDeps): Promise<OpenResult> {
  onStage({ stage: 'opening' });
  const bytes = snapshotBytes ?? (() => database.exportBytes());

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
  // Held across the check below too: a verify-failed open goes back to the same copy a migration-failed one would.
  let restore: SnapshotInfo | null = null;
  if (pending.length) {
    const copy = await takeSnapshot({ snapshots, bytes, version, onStage });
    restore = copy.snapshot;
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
        // The missing copy is said here, where it matters: this is the screen where the user goes looking for one.
        detail: copy.skipped ? `${say(error)} — and no safety copy was taken first: ${copy.skipped}` : say(error),
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
      restore,
      kind: 'verify-failed',
      headline: 'We checked your data after the update and something did not add up.',
      detail: problems.map((p) => `${p.kind}: ${p.detail}`).join('; '),
      version: applied[0] ?? 0,
    });
  }

  try {
    // The store rides along on the opened app: the day's copy is taken from the first idle callback after
    // the first paint, which is the one place that knows a screen has actually appeared.
    return { ok: true, app: { ...(await openAppDb(database)), safety: { snapshots, bytes } }, applied };
  } catch (error) {
    return { ok: false, reason: { kind: 'cannot-open', headline: 'We could not finish opening your data.', detail: say(error), exportable: true } };
  }
}
