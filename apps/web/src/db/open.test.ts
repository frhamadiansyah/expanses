import { expenseLines } from '@expanses/core';
import {
  checkLedgerHealth,
  createAccount,
  createDatabase,
  createWorkspace,
  databaseVersion,
  LATEST_VERSION,
  listAccounts,
  migrate,
  MIGRATIONS,
  type Migration,
  postTransaction,
} from '@expanses/db';
import { createNodeExecutor, type NodeExecutor } from '@expanses/db/node';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NO_SNAPSHOTS, openSafely, type OpenStage } from './open';
import { MANIFEST, memorySnapshots, restoreSnapshot } from './snapshots';

let executor: NodeExecutor | undefined;
/** Every extra engine a test starts, closed whatever the test did. */
const spares: NodeExecutor[] = [];
const spare = (): NodeExecutor => {
  const made = createNodeExecutor();
  spares.push(made);
  return made;
};

afterEach(() => {
  vi.useRealTimers();
  executor?.close();
  executor = undefined;
  while (spares.length) spares.pop()!.close();
});

function opened(migrations: Migration[] = MIGRATIONS) {
  executor = createNodeExecutor();
  const database = createDatabase(executor);
  const stages: OpenStage[] = [];
  return {
    database,
    stages,
    run: () => openSafely({ database, migrations, snapshots: NO_SNAPSHOTS, onStage: (stage) => stages.push(stage) }),
  };
}

const versions = (migrations: Migration[] = MIGRATIONS) => [...migrations].map((m) => m.version).sort((a, b) => a - b);

describe('openSafely', () => {
  it('opens a new database, migrates it, and reports the stages in order', async () => {
    const o = opened();
    const result = await o.run();
    expect(result.ok).toBe(true);
    // Derived, never a literal: the run is one "migrating" per migration plus the closing call that
    // says the run finished, wrapped by the read-only stages either side.
    expect(o.stages[0]).toEqual({ stage: 'opening' });
    expect(o.stages.at(-1)).toEqual({ stage: 'checking' });
    const middle = o.stages.slice(1, -1);
    expect(middle.map((s) => s.stage)).toEqual(Array.from({ length: MIGRATIONS.length + 1 }, () => 'migrating'));
    // `copied` is false and must be: a device with no data yet has nothing to copy before the first update.
    expect(middle.at(-1)).toEqual({
      stage: 'migrating',
      done: MIGRATIONS.length,
      total: MIGRATIONS.length,
      name: MIGRATIONS.at(-1)!.name,
      copied: false,
    });
    if (result.ok) expect(result.applied).toEqual(versions());
  });

  it('refuses a database a newer build wrote, and changes not one byte', async () => {
    const o = opened();
    await migrate(o.database);
    await o.database.execScript(
      `INSERT INTO schema_migrations (version, name, applied_at) VALUES (${LATEST_VERSION + 2}, 'future', '2027-01-01T00:00:00.000Z')`,
    );
    const before = await o.database.exportBytes();

    const result = await o.run();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason.kind).toBe('newer-database');
      expect(result.reason.exportable).toBe(true);
      expect(result.reason.detail).toContain(String(LATEST_VERSION + 2));
    }
    expect(Array.from(await o.database.exportBytes())).toEqual(Array.from(before));
  });

  it('stops at a corrupt file before it writes anything', async () => {
    const o = opened();
    await migrate(o.database);
    const bytes = await o.database.exportBytes();
    bytes.fill(0xff, 4096 * 10, 4096 * 30);
    await o.database.importBytes(bytes);

    const result = await o.run();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.kind).toBe('corrupt');
    // "opening" only: nothing was migrated on a file we could not read.
    expect(o.stages.map((s) => s.stage)).toEqual(['opening']);
  });

  it('turns a migration that throws into a reason, not an exception', async () => {
    const boom: Migration = { version: LATEST_VERSION + 52, name: 'boom', sql: 'INSERT INTO nope (x) VALUES (1);' };
    const o = opened([...MIGRATIONS, boom]);
    const result = await o.run();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason.kind).toBe('migration-failed');
      expect(result.reason.rolledBack).toBe(false); // NO_SNAPSHOTS: nothing was kept, so nothing was undone
      expect(result.reason.exportable).toBe(true);
    }
  });

  it('turns a migration that passes but breaks the ledger into verify-failed', async () => {
    const o = opened();
    const first = await o.run();
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // A posted transaction, so the ledger has something the wrecker can break; an empty ledger proves nothing.
    const { database, ws } = first.app;
    const bank = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    const groceries = (await listAccounts(database, ws)).find((a) => a.systemKey === 'household.groceries')!.id;
    await postTransaction(database, ws, {
      occurredOn: '2026-09-03',
      description: 'Superindo',
      lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: bank.id, amountMinor: 120_000, currency: 'IDR' }),
    });

    const wrecker: Migration = { version: LATEST_VERSION + 51, name: 'wrecker', sql: 'DELETE FROM entries WHERE 1 = 1;' };
    const second = await openSafely({
      database: o.database,
      migrations: [...MIGRATIONS, wrecker],
      snapshots: NO_SNAPSHOTS,
      onStage: () => undefined,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason.kind).toBe('verify-failed');
  });

  it('copies the database before it migrates, and only when there is something to migrate', async () => {
    executor = createNodeExecutor();
    const database = createDatabase(executor);
    const store = memorySnapshots();
    await openSafely({ database, snapshots: store, onStage: () => undefined });
    const [first] = await store.list();
    expect(first).toBeUndefined(); // a brand-new database has nothing worth copying

    // Now a real upgrade: stop at 44, then open with the full list.
    executor.close();
    executor = createNodeExecutor();
    const older = createDatabase(executor);
    await migrate(older, MIGRATIONS.filter((m) => m.version <= 44));
    const store2 = memorySnapshots();
    const result = await openSafely({ database: older, snapshots: store2, onStage: () => undefined });
    expect(result.ok).toBe(true);
    const [snapshot] = await store2.list();
    expect(snapshot).toMatchObject({ reason: 'before-migration', schemaVersion: 44 });
    // The copy really is the database as it was — version 44 — while the live one has moved on to this build's newest.
    const copy = createDatabase(spare());
    await copy.importBytes(await store2.read(snapshot!.file));
    expect(await databaseVersion(copy)).toBe(44);
    expect(await databaseVersion(older)).toBe(LATEST_VERSION);
  });

  it('opens anyway when no copy can be taken, and says so if the update then fails', async () => {
    executor = createNodeExecutor();
    const database = createDatabase(executor);
    await migrate(database, MIGRATIONS.filter((m) => m.version <= 44));

    const boom: Migration = { version: LATEST_VERSION + 53, name: 'boom', sql: 'INSERT INTO nope (x) VALUES (1);' };
    const result = await openSafely({ database, migrations: [...MIGRATIONS, boom], snapshots: NO_SNAPSHOTS, onStage: () => undefined });
    expect(result.ok).toBe(false);
    // A store that refuses is never a wall — but the user is told there is nothing to go back to.
    if (!result.ok) expect(result.reason.detail).toContain('no safety copy was taken first');
  });

  it('keeps two copies and prunes the rest, and never hands back one that is gone', async () => {
    executor = createNodeExecutor();
    const database = createDatabase(executor);
    await migrate(database);
    const store = memorySnapshots();
    const bytes = await database.exportBytes();

    // Three in a row, on three different days, so the names cannot collide the way same-second copies do.
    vi.useFakeTimers();
    const written = [];
    for (const takenAt of ['2026-09-16T10:00:00.000Z', '2026-09-17T10:00:00.000Z', '2026-09-18T10:00:00.000Z']) {
      vi.setSystemTime(new Date(takenAt));
      written.push(await store.write(bytes, 'daily', LATEST_VERSION));
    }
    vi.useRealTimers();

    const kept = await store.list();
    expect(kept.map((s) => s.file)).toEqual([written[2]!.file, written[1]!.file]);
    await expect(store.read(written[0]!.file)).rejects.toThrow(/no longer on this device/);
  });

  /**
   * A database one build behind, with a posted transaction in it: the ledger has to have something in it
   * for a rollback to be worth anything, and something a broken update can be caught unbalancing.
   */
  async function seeded() {
    executor = createNodeExecutor();
    const database = createDatabase(executor);
    await migrate(
      database,
      MIGRATIONS.filter((m) => m.version <= 45),
    );
    const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    const bank = await createAccount(database, ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    const groceries = (await listAccounts(database, ws)).find((a) => a.systemKey === 'household.groceries')!.id;
    await postTransaction(database, ws, {
      occurredOn: '2026-09-03',
      description: 'Superindo',
      lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: bank.id, amountMinor: 120_000, currency: 'IDR' }),
    });
    return { database, ws };
  }

  /** Never a literal: a fake migration has to sit past everything this build really ships. */
  const NEXT = LATEST_VERSION + 1;

  it('puts the database back when a migration throws part-way', async () => {
    const { database } = await seeded();
    const before = await database.exportBytes();
    const boom: Migration = { version: NEXT, name: 'boom', sql: 'CREATE TABLE boom (x TEXT);\nINSERT INTO nope (x) VALUES (1);' };
    const store = memorySnapshots();

    const result = await openSafely({ database, migrations: [...MIGRATIONS, boom], snapshots: store, onStage: () => undefined });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatchObject({ kind: 'migration-failed', rolledBack: true });
    // Back at 45: the real 46 and 47 that had already gone in were undone with the broken one.
    expect(await databaseVersion(database)).toBe(45);
    expect(Array.from(await database.exportBytes())).toEqual(Array.from(before));
    expect(await store.blockedVersion()).toBe(NEXT);
  });

  it('blocks the update that threw, not the one after it, when this build re-runs a renamed migration', async () => {
    const { database } = await seeded();
    /*
     * A build that renames 45. `migrate` drops the row recorded under the old name and runs its own 45
     * again, so its list of work is one longer than `pendingMigrations` — the skew that used to make the
     * block land on the migration *above* the culprit, and let the broken one run a second time.
     */
    const renamed: Migration = { version: 45, name: 'account_types_v2', sql: 'CREATE TABLE IF NOT EXISTS account_types_marker (x TEXT);' };
    const boom: Migration = { version: NEXT, name: 'boom', sql: 'INSERT INTO nope (x) VALUES (1);' };
    // One more past the broken one, so an off-by-one has somewhere wrong to land.
    const after: Migration = { version: NEXT + 1, name: 'after_boom', sql: 'CREATE TABLE after_boom (x TEXT);' };
    const migrations = [...MIGRATIONS.filter((m) => m.version !== 45), renamed, boom, after];
    const store = memorySnapshots();

    const result = await openSafely({ database, migrations, snapshots: store, onStage: () => undefined });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatchObject({ kind: 'migration-failed', rolledBack: true });
    // The version the engine was holding when it threw, named by the migration itself.
    expect(await store.blockedVersion()).toBe(NEXT);

    // And the point of naming it correctly: the next open never reaches the broken one again.
    const stages: OpenStage[] = [];
    const second = await openSafely({ database, migrations, snapshots: store, onStage: (s) => stages.push(s) });
    expect(second.ok).toBe(true);
    expect(stages.some((s) => s.stage === 'migrating' && s.name === 'boom')).toBe(false);
  });

  it('puts the database back when the update finishes but the ledger does not add up', async () => {
    const { database, ws } = await seeded();
    const wrecker: Migration = { version: NEXT, name: 'wrecker', sql: 'DELETE FROM entries WHERE amount_minor < 0;' };
    const store = memorySnapshots();

    const result = await openSafely({ database, migrations: [...MIGRATIONS, wrecker], snapshots: store, onStage: () => undefined });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatchObject({ kind: 'verify-failed', rolledBack: true });
    expect(await checkLedgerHealth(database, ws)).toEqual({ unbalanced: [], orphanEntries: [], orphanTransactions: [] });
    expect(await databaseVersion(database)).toBe(45);
    // Nothing in the batch is tried again: which of them wrecked the ledger is not knowable from here.
    expect(await store.blockedVersion()).toBe(46);
  });

  it('puts the database back when the check after the update throws instead of answering', async () => {
    const { database, ws } = await seeded();
    const before = await database.exportBytes();
    /*
     * The check reads the ledger, so an update that takes a ledger table away does not hand back problems —
     * it throws. A throw has to be the same outcome as a failed check: put back, blocked, and said plainly.
     * Left unguarded it escaped the rollback altogether and left a half-updated file behind.
     */
    const wrecker: Migration = { version: NEXT, name: 'wrecker', sql: 'DROP TABLE entries;' };
    const store = memorySnapshots();

    const result = await openSafely({ database, migrations: [...MIGRATIONS, wrecker], snapshots: store, onStage: () => undefined });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatchObject({ kind: 'verify-failed', rolledBack: true });
    expect(await databaseVersion(database)).toBe(45);
    expect(Array.from(await database.exportBytes())).toEqual(Array.from(before));
    expect(await checkLedgerHealth(database, ws)).toEqual({ unbalanced: [], orphanEntries: [], orphanTransactions: [] });
    expect(await store.blockedVersion()).toBe(46);
  });

  it('does not try the same failed update again on the next open', async () => {
    const { database } = await seeded();
    const boom: Migration = { version: NEXT, name: 'boom', sql: 'INSERT INTO nope (x) VALUES (1);' };
    const store = memorySnapshots();
    await openSafely({ database, migrations: [...MIGRATIONS, boom], snapshots: store, onStage: () => undefined });

    const stages: OpenStage[] = [];
    const second = await openSafely({ database, migrations: [...MIGRATIONS, boom], snapshots: store, onStage: (s) => stages.push(s) });
    expect(second.ok).toBe(true); // it opens, at the version below the broken update, rather than failing again
    expect(await databaseVersion(database)).toBe(LATEST_VERSION);
    expect(stages.some((s) => s.stage === 'migrating' && s.name === 'boom')).toBe(false);
    if (second.ok) expect(second.app.update).toMatchObject({ blocked: NEXT });
  });

  it('lifts the block when a build arrives with migrations past the one that failed', async () => {
    const store = memorySnapshots();
    await store.block(NEXT, LATEST_VERSION);
    expect(await store.blockedVersion()).toBe(NEXT); // asked with no build: whatever is on the device
    expect(await store.blockedVersion(LATEST_VERSION)).toBe(NEXT); // the build that set it, still held
    // A build that ships one migration more is a different build: the update it was told not to attempt was
    // that older app's judgement, and holding it would keep a fixed migration out for ever.
    expect(await store.blockedVersion(LATEST_VERSION + 1)).toBe(null);
  });

  it('says so plainly when the rollback itself cannot be done', async () => {
    const { database } = await seeded();
    const boom: Migration = { version: NEXT, name: 'boom', sql: 'INSERT INTO nope (x) VALUES (1);' };
    const store = memorySnapshots();
    store.read = async () => {
      throw new Error('the copy is gone');
    };

    const result = await openSafely({ database, migrations: [...MIGRATIONS, boom], snapshots: store, onStage: () => undefined });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatchObject({ kind: 'migration-failed', rolledBack: false, exportable: true });
    // Nothing is blocked that was not put back: the next open must be free to try, and to fail honestly again.
    expect(await store.blockedVersion()).toBe(null);
  });

  it('refuses a copy that does not read back as the database it was given', async () => {
    const store = memorySnapshots();
    await expect(store.write(new TextEncoder().encode('not a database at all'), 'daily', LATEST_VERSION)).rejects.toThrow(/did not verify/);
    // Nothing is advertised that is not there: a failed copy leaves the manifest exactly as it was.
    expect(await store.list()).toEqual([]);
  });
});

describe('the snapshot store', () => {
  /** A real database, and two copies of it taken on two different days, over a Map the test can reach into. */
  async function twoCopies() {
    executor = createNodeExecutor();
    const database = createDatabase(executor);
    await migrate(database);
    const bytes = await database.exportBytes();
    const files = new Map<string, Uint8Array>();
    const store = memorySnapshots(files);

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-17T10:00:00.000Z'));
    const older = await store.write(bytes, 'before-migration', LATEST_VERSION);
    vi.setSystemTime(new Date('2026-09-18T10:00:00.000Z'));
    const newest = await store.write(bytes, 'daily', LATEST_VERSION);
    vi.useRealTimers();
    return { bytes, database, files, newest, older, store };
  }

  it('keeps a copy whose file is longer than the database its own header declares', async () => {
    executor = createNodeExecutor();
    const database = createDatabase(executor);
    await migrate(database);
    const bytes = await database.exportBytes();
    /*
     * What the engine really hands over after a Restore or a backup import: `importDb` writes the new
     * database into the slot at offset 4096 and never truncates, so the slot keeps the tail of the larger
     * file it used to hold until SQLite's next commit trims it. Refusing that export would switch the
     * safety net off on exactly the device that has just been through a recovery.
     */
    const withTail = new Uint8Array(bytes.length + 8192);
    withTail.set(bytes);
    withTail.fill(0xff, bytes.length);

    const store = memorySnapshots();
    const info = await store.write(withTail, 'daily', LATEST_VERSION);
    expect((await store.list()).map((s) => s.file)).toEqual([info.file]);

    // A copy, not a shape: the database that header describes still opens at this build's newest version.
    const stored = await store.read(info.file);
    expect(stored.length).toBe(withTail.length);
    const copy = createDatabase(spare());
    await copy.importBytes(stored.subarray(0, bytes.length));
    expect(await databaseVersion(copy)).toBe(LATEST_VERSION);

    // A file *shorter* than its header claims is a different thing, and is still refused.
    await expect(memorySnapshots().write(bytes.slice(0, bytes.length - 4096), 'daily', LATEST_VERSION)).rejects.toThrow(/did not verify/);
  });

  /**
   * The manifest fallback, which is a named constraint of this branch: a copy must stay restorable when
   * `manifest.json` is the thing that broke. Three ways for it to be broken, and the third — a file that
   * parses but says nothing usable — is the one a partial write actually leaves behind.
   */
  const brokenManifests: [string, string | null][] = [
    ['is missing', null],
    ['will not parse', 'not json at all'],
    ['parses into entries that are not snapshots', '{"snapshots":[{},{"file":42}],"blockedVersion":null,"blockedBuild":null}'],
  ];

  for (const [what, contents] of brokenManifests) {
    it(`lists and restores the files on the device when the manifest ${what}`, async () => {
      const { bytes, files, newest, older, store } = await twoCopies();
      if (contents === null) files.delete(MANIFEST);
      else files.set(MANIFEST, new TextEncoder().encode(contents));

      const kept = await store.list();
      expect(kept.map((s) => s.file).sort()).toEqual([newest.file, older.file].sort());
      // Restorable, not merely listed: the bytes come back whole and open as the database they were taken from.
      const restored = await store.read(newest.file);
      expect(restored.length).toBe(bytes.length);
      const copy = createDatabase(spare());
      await copy.importBytes(restored);
      expect(await databaseVersion(copy)).toBe(LATEST_VERSION);
    });
  }

  it('keeps a copy of what Restore is about to overwrite', async () => {
    const { newest, store } = await twoCopies();
    // The live database is one build behind the copies, so the copy kept of it can be told apart by version.
    const live = createDatabase(spare());
    await migrate(live, MIGRATIONS.filter((m) => m.version <= 44));
    const liveBytes = await live.exportBytes();

    const handed: Uint8Array[] = [];
    await restoreSnapshot({
      snapshots: store,
      file: newest.file,
      live: async () => liveBytes,
      restore: async (b) => {
        handed.push(b);
      },
    });

    // The restore happened, with the copy that was asked for.
    expect(handed).toHaveLength(1);
    expect(Array.from(handed[0]!)).toEqual(Array.from(await store.read(newest.file)));
    // And the way back: the database as it stood a moment before, kept under its own reason.
    const before = (await store.list()).find((s) => s.reason === 'before-restore');
    expect(before).toBeDefined();
    const undo = createDatabase(spare());
    await undo.importBytes(await store.read(before!.file));
    expect(await databaseVersion(undo)).toBe(44);
  });

  it('restores anyway when no copy of the live database can be kept', async () => {
    const { newest, store } = await twoCopies();
    store.write = async () => {
      throw new Error('There is not enough free space on this device to keep a safety copy.');
    };

    const handed: Uint8Array[] = [];
    await restoreSnapshot({ snapshots: store, file: newest.file, live: async () => new Uint8Array([1, 2, 3]), restore: async (b) => void handed.push(b) });
    // A safety copy that cannot be taken is never a wall between a user and their own data.
    expect(handed).toHaveLength(1);

    // The same holds when there is nothing on the device to copy at all.
    handed.length = 0;
    await restoreSnapshot({ snapshots: store, file: newest.file, live: async () => null, restore: async (b) => void handed.push(b) });
    expect(handed).toHaveLength(1);
  });
});
