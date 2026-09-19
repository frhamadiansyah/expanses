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
import { memorySnapshots } from './snapshots';

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
    expect(middle.at(-1)).toEqual({ stage: 'migrating', done: MIGRATIONS.length, total: MIGRATIONS.length, name: MIGRATIONS.at(-1)!.name });
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
