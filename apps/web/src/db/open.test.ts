import { expenseLines } from '@expanses/core';
import {
  createAccount,
  createDatabase,
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

  it('refuses a copy that does not read back as the database it was given', async () => {
    const store = memorySnapshots();
    await expect(store.write(new TextEncoder().encode('not a database at all'), 'daily', LATEST_VERSION)).rejects.toThrow(/did not verify/);
    // Nothing is advertised that is not there: a failed copy leaves the manifest exactly as it was.
    expect(await store.list()).toEqual([]);
  });
});
