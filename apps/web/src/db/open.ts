import {
  checkDatabase,
  checkStructure,
  type Database,
  databaseBytes,
  databaseVersion,
  futureVersions,
  type IntegrityProblem,
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
  /**
   * Whether this was found with the app already open and running, rather than on the way in (spec §3.4).
   * It changes nothing about what is offered — the file is the file — and only what the screen says: the
   * user was looking at their money a second ago and is owed a sentence about where it went.
   */
  midSession?: boolean;
}

export type OpenStage =
  | { stage: 'opening' | 'snapshotting' | 'checking' }
  /**
   * `done` is the count *finished*, reported before the next one is picked up, so the step being worked
   * on is `done + 1`. `copied` says whether a safety copy was really taken before any of this ran — a
   * first open on a new device has nothing to copy, and a copy can fail — so the screen never reassures
   * anyone about a copy that is not there.
   */
  | { stage: 'migrating'; done: number; total: number; name: string; copied: boolean };

/**
 * The copies kept beside the live database, implemented over OPFS in `snapshots.ts`. `block`/`unblock`
 * record a version that must not be tried again, so an update that failed once does not fail the same
 * way on every reload.
 */
export interface SnapshotStore {
  list(): Promise<SnapshotInfo[]>;
  write(bytes: Uint8Array, reason: SnapshotReason, schemaVersion: number): Promise<SnapshotInfo>;
  read(file: string): Promise<Uint8Array>;
  /**
   * The update that must not be attempted, or null. `build` is the highest version the *asking* build
   * knows: a block is one app version's judgement about one broken migration, so a build that ships
   * migrations past it is told there is no block, and its fixed migration gets its chance.
   */
  blockedVersion(build?: number): Promise<number | null>;
  /** Records `version` as not to be attempted, and the build (its highest known version) that decided so. */
  block(version: number, build: number): Promise<void>;
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
  /**
   * The schema version the live database is really at, so a copy taken later in the session is named for
   * what it holds. Deliberately not `LATEST_VERSION`: on a device holding a blocked update the file sits
   * one or more versions below this build's newest, and a copy labelled with the build would tell the
   * Backup page and the recovery screen a version those bytes do not have.
   */
  schemaVersion: number;
}

/**
 * The §11.4 size guard, from the one module that holds it. It is kept apart so the end-to-end fixture that
 * has to build a database on the far side of the line can import the line rather than restate it; every
 * caller here and elsewhere still reads it from `./open`.
 */
export { QUICK_CHECK_LIMIT_BYTES, quickCheckAffordable } from './size-guard';
import { quickCheckAffordable } from './size-guard';

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
 * Undoing a failed update from the copy taken before it.
 *
 * The bytes go back exactly as they were taken, so what the user ends up with is their database at the old
 * schema version with the whole ledger in it — not a repaired one, and never a half-updated one presented as
 * fine. Three things can be true afterwards and each is said plainly: there was no copy to go back to; the
 * copy would not go back; or it did, in which case the update that broke is recorded as one not to attempt
 * again. A block is only ever written after a rollback that worked: blocking an update we could not undo
 * would leave the user on a half-updated file and tell the next open to leave it alone.
 */
async function rollback(deps: {
  snapshots: SnapshotStore;
  database: Database;
  restore: SnapshotInfo | null;
  kind: RecoveryKind;
  headline: string;
  detail: string;
  version: number;
  build: number;
}): Promise<OpenResult> {
  const reason = (rolledBack: boolean, detail: string): OpenResult => ({
    ok: false,
    reason: { kind: deps.kind, headline: deps.headline, detail, exportable: true, rolledBack },
  });

  if (!deps.restore) return reason(false, deps.detail);

  // A version at or below zero names no migration this build could skip, and recording one would tell the
  // next open to run nothing at all. It cannot happen from here any more; it must not become possible.
  const blockable = deps.version > 0;

  try {
    /*
     * The worker's `import` op keeps the current bytes and puts them back if the import fails, so a rollback
     * that cannot be done leaves the half-updated file rather than nothing at all — which is why the screen
     * this returns to can still offer Export either way.
     */
    await deps.database.importBytes(await deps.snapshots.read(deps.restore.file));
    const problems = await checkStructure(deps.database);
    if (problems.length) throw new Error(problems.map((p) => p.detail).join('; '));
  } catch (error) {
    return reason(false, `${deps.detail} — and the copy taken before the update could not be put back either: ${say(error)}`);
  }

  if (blockable) {
    try {
      await deps.snapshots.block(deps.version, deps.build);
    } catch (error) {
      // The data is back; the worst a failed block costs is that the next open tries the same update again.
      console.warn('The failed update could not be recorded as one to skip', error);
    }
  }
  return reason(true, deps.detail);
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

  /*
   * An update that was undone once must not be attempted at every launch: it would fail the same way, cost
   * another snapshot each time, and leave the user staring at the recovery screen instead of their money. A
   * block means "skip this update and open at the version below it", never "refuse to start" — the app at
   * last month's schema is worth incomparably more than no app at all. It lifts when a build arrives with
   * migrations past the blocked one (`blockedVersion` compares builds), or when the user presses "Try the
   * update again" on the card above the page, which calls `unblock` and reloads.
   */
  const build = Math.max(...migrations.map((m) => m.version));
  const recorded = await snapshots.blockedVersion(build).catch((error: unknown) => {
    // Said out loud rather than swallowed: a store that will not answer means every update is attempted,
    // including one this device has already been told not to try, and that is worth a line in the console.
    console.warn('The record of a blocked update could not be read, so none will be skipped', error);
    return null;
  });
  // A block at or below zero names no migration; honouring it would filter the list down to nothing and
  // open an un-migrated app, which is worse than running the update it was meant to skip.
  const blocked = recorded !== null && recorded > 0 ? recorded : null;
  const allowed = blocked === null ? migrations : migrations.filter((m) => m.version < blocked);

  /*
   * An existing file is checked before it is touched; a brand-new one has nothing to check.
   *
   * This is the branch's only structural check on an ordinary launch, and it is size-guarded because it
   * sits on the path to first paint (spec §11.4). Running it here and *not* again below is also why the
   * same `quick_check` no longer runs twice per open.
   */
  if (version > 0 && quickCheckAffordable(await databaseBytes(database))) {
    const problems = await checkStructure(database);
    if (problems.length) return { ok: false, reason: corrupt(problems.map((p) => p.detail).join('; ')) };
  }

  const pending = await pendingMigrations(database, allowed);
  let applied: number[] = [];
  // Held across the check below too: a verify-failed open goes back to the same copy a migration-failed one would.
  let restore: SnapshotInfo | null = null;
  /*
   * Which migration is in the engine's hands right now, so a failure blocks the one that broke rather than
   * the whole run. It is the version `migrate` names as it picks each step up, never this list indexed by
   * the count finished: `migrate` recomputes its own list of work — a version recorded under a name this
   * build does not use is dropped and run again — so the two lists can differ in length, and counting into
   * this one would block the migration *after* the culprit and let the broken one run again on the next open.
   */
  let attempting = pending[0]?.version ?? 0;
  if (pending.length) {
    const copy = await takeSnapshot({ snapshots, bytes, version, onStage });
    restore = copy.snapshot;
    try {
      applied = await migrate(database, allowed, {
        onProgress: (done, total, name, migrationVersion) => {
          attempting = migrationVersion;
          onStage({ stage: 'migrating', done, total, name, copied: restore !== null });
        },
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
        version: attempting,
        build,
      });
    }
  }

  /*
   * The verification is the last stage of an *update*, and only of an update.
   *
   * It exists so a migration that finishes but leaves the ledger wrong is undone from the copy taken
   * minutes earlier. With nothing pending there is no copy, nothing to undo and nothing to blame — and
   * running it anyway turned one unbalanced transaction, from any cause and any age, into a permanent
   * lock-out: "Something did not add up after the update" on a launch where no update ran, offering a
   * restore of a copy carrying the same rows, or Start fresh. That is the deletion this branch exists to
   * prevent. Spec §3.1 stage 7 and §5.1 both place this check after `migrate()`, and here it is.
   *
   * An ordinary launch still asks SQLite about the file itself, once, above. What it deliberately does
   * not do is walk the ledger: nothing found there can keep a user out of data they can still read and
   * export, so looking for it on the way in would only cost every launch the time it takes.
   */
  if (applied.length) {
    onStage({ stage: 'checking' });
    /*
     * A check that will not answer counts as a check that failed. `checkDatabase` catches its own, but the
     * belt is worth the braces here: whatever escapes it, the one thing that must not happen is a throw
     * sailing past the rollback below, leaving the user with the half-updated file, nothing blocked, and a
     * screen that says only that we could not open their data.
     */
    let problems: IntegrityProblem[];
    try {
      // `deep` because something has just been written: `integrity_check` is the one that catches an index
      // row missing from its table, and it subsumes the `quick_check` already run above.
      problems = await checkDatabase(database, { deep: true });
    } catch (error) {
      problems = [{ kind: 'ledger-unreadable', detail: say(error) }];
    }
    if (problems.length) {
      return rollback({
        snapshots,
        database,
        restore,
        kind: 'verify-failed',
        headline: 'We checked your data after the update and something did not add up.',
        detail: problems.map((p) => `${p.kind}: ${p.detail}`).join('; '),
        // The whole run is blocked, not one step of it: which migration of the batch left the ledger wrong is
        // not knowable from a check made after all of them ran. `applied` is never empty inside this branch.
        version: applied[0]!,
        build,
      });
    }

    /*
     * Spec §5.1 check 3 — the update landed.
     *
     * `migrate` records each version in the same transaction as the change it makes, so this is not the
     * usual way an update goes wrong; it is the one thing neither check above can see. A file whose
     * `schema_migrations` no longer agrees with what just ran would be migrated again on the next launch,
     * over a schema that already holds the change, and would fail *then* — with the copy taken minutes ago
     * long gone — rather than here, where it can still be put back.
     *
     * Asked against `allowed` rather than the whole build, because the spec's "equals this build's highest"
     * is not the question on a device holding a block: an update this open deliberately skipped has not
     * gone missing. What must be true is narrower and always true: nothing this open was allowed to apply
     * is still outstanding.
     */
    let outstanding: string | null = null;
    try {
      const left = await pendingMigrations(database, allowed);
      if (left.length) outstanding = `the update finished but did not record ${left.map((m) => m.version).join(', ')}`;
    } catch (error) {
      // Unreadable is not "fine": the versions are the one record of what this open did to the file.
      outstanding = `the versions this update recorded could not be read back: ${say(error)}`;
    }
    if (outstanding) {
      return rollback({
        snapshots,
        database,
        restore,
        kind: 'verify-failed',
        headline: 'We checked your data after the update and something did not add up.',
        detail: outstanding,
        version: applied[0]!,
        build,
      });
    }
  }

  try {
    // The store rides along on the opened app: the day's copy is taken from the first idle callback after
    // the first paint, which is the one place that knows a screen has actually appeared.
    return {
      ok: true,
      app: {
        ...(await openAppDb(database, allowed)),
        // The version the file is really at, so a copy taken later in the session is labelled with what it
        // holds rather than with what this build could have produced.
        safety: { snapshots, bytes, schemaVersion: applied.length ? Math.max(...applied) : version },
        // What this open did to the schema, and what it deliberately left alone, for the card above the page.
        update: { applied, from: version, blocked },
      },
      applied,
    };
  } catch (error) {
    /*
     * A skipped update is worth naming here. The app is running at the version below a blocked one, and
     * every repo in this build is written against this build's schema — which holds today, and is enforced
     * by a test that opens with this build's own newest update blocked and then uses the app. If a future
     * migration ever adds a column an opening read selects, the failure lands exactly here, and the one
     * fact that explains it must not be missing from the Details a user copies into a bug report.
     */
    const detail = blocked === null ? say(error) : `${say(error)} — running at update ${blocked - 1}, with ${blocked} skipped after it failed once`;
    return { ok: false, reason: { kind: 'cannot-open', headline: 'We could not finish opening your data.', detail, exportable: true } };
  }
}
