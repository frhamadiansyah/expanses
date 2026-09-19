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
  type SqlExecutor,
} from '@expanses/db';
import { createNodeExecutor, type NodeExecutor } from '@expanses/db/node';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lastGoodCopy } from '../features/recovery/recovery-copy';
import { fatalKind } from './fatal';
import { NO_SNAPSHOTS, openSafely, type OpenStage, quickCheckAffordable, QUICK_CHECK_LIMIT_BYTES } from './open';
import { snapshotName } from './snapshot-policy';
import { MANIFEST, memorySnapshots, restoreSnapshot } from './snapshots';
import { createWorkerExecutor } from './worker-executor';

/**
 * The version one update behind the newest. Not `LATEST_VERSION - 1`: migration numbers may skip — 0048 is
 * reserved by another plan and never shipped — so "one behind" is the highest version this build actually carries
 * below its newest, which is what a device with a blocked update is really left sitting at.
 */
const PREVIOUS_VERSION = Math.max(...MIGRATIONS.filter((m) => m.version < LATEST_VERSION).map((m) => m.version));

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

/**
 * The worker's side of the boundary, over a real engine: every op answered the way `worker.ts` answers it,
 * including the fatal tag it puts on a `query` or a `script` that SQLite says is malformed. It exists so the
 * open can be driven through `createWorkerExecutor` — the executor the app really runs on, strike and all —
 * rather than straight against a `SqlExecutor` that has no such thing.
 */
function workerOver(inner: SqlExecutor) {
  const worker = {
    onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
    onerror: null as ((event: ErrorEvent) => void) | null,
    ops: [] as string[],
    terminate: () => undefined,
    postMessage(message: { id: number; op: string; sql?: string; params?: unknown[]; method?: 'run' | 'all' | 'values' | 'get'; bytes?: Uint8Array }) {
      worker.ops.push(message.op);
      void (async () => {
        let reply: Record<string, unknown>;
        try {
          let result: unknown = null;
          if (message.op === 'query') result = await inner.query(message.sql!, message.params!, message.method!);
          else if (message.op === 'script') await inner.execScript(message.sql!);
          else if (message.op === 'export' || message.op === 'snapshot') result = await inner.exportBytes();
          else if (message.op === 'import') await inner.importBytes(message.bytes!);
          reply = { id: message.id, result };
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          const kind = message.op === 'query' || message.op === 'script' ? fatalKind(detail) : null;
          reply = kind ? { id: message.id, error: detail, fatal: kind } : { id: message.id, error: detail };
        }
        worker.onmessage?.({ data: reply } as MessageEvent<unknown>);
      })();
    },
  };
  return worker;
}

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

  /**
   * The blocking finding of the whole-branch review, as a test.
   *
   * A ledger that does not add up is not a reason to keep someone out of their own money. With nothing
   * pending there is no copy taken and nothing to roll back to, so the verification could only ever end in
   * `verify-failed / rolledBack: false` — a permanent lock-out, on every launch, offering a restore of a
   * copy carrying the same rows or the button that deletes everything. The check belongs after `migrate()`
   * (spec §3.1 stage 7, §5.1) and nowhere else.
   */
  it('opens a database whose ledger does not add up, when no update ran', async () => {
    const o = opened();
    const first = await o.run();
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const { database, ws } = first.app;
    const bank = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    const groceries = (await listAccounts(database, ws)).find((a) => a.systemKey === 'household.groceries')!.id;
    await postTransaction(database, ws, {
      occurredOn: '2026-09-03',
      description: 'Superindo',
      lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: bank.id, amountMinor: 120_000, currency: 'IDR' }),
    });
    // The exact damage the review locked a user out with: one side of a posted transaction gone.
    await database.execScript('DELETE FROM entries WHERE amount_minor < 0');

    const stages: OpenStage[] = [];
    const store = memorySnapshots();
    const second = await openSafely({ database: o.database, snapshots: store, onStage: (stage) => stages.push(stage) });

    expect(second.ok).toBe(true);
    // Nothing was updated, so there is no post-update verification to run — and no `checking` stage.
    expect(stages.map((s) => s.stage)).toEqual(['opening']);
    // Nothing was blocked and nothing was replaced: the problem is still there, and so is every row.
    expect(await store.blockedVersion()).toBe(null);
    expect(await databaseVersion(o.database)).toBe(LATEST_VERSION);
    expect((await checkLedgerHealth(o.database, ws)).unbalanced.length).toBeGreaterThan(0);
  });

  /**
   * Spec §11.4 bought a per-open `quick_check` with a measurement and a size guard. It was being charged
   * twice — once before the migrations and once inside `checkDatabase` afterwards — on the path to first
   * paint, with a full ledger scan on top of it on every launch.
   */
  it('asks SQLite about the file once an open, never twice', async () => {
    executor = createNodeExecutor();
    const asked: string[] = [];
    const inner = executor;
    const watching: SqlExecutor = {
      query: (sql, params, method) => {
        const pragma = /PRAGMA\s+(quick_check|integrity_check)/i.exec(sql);
        if (pragma) asked.push(pragma[1]!.toLowerCase());
        return inner.query(sql, params, method);
      },
      execScript: (sql) => inner.execScript(sql),
      exportBytes: () => inner.exportBytes(),
      importBytes: (bytes) => inner.importBytes(bytes),
    };
    const database = createDatabase(watching);

    // A brand-new file: nothing to check on the way in, one deep check after the update that just ran.
    await openSafely({ database, snapshots: memorySnapshots(), onStage: () => undefined });
    expect(asked).toEqual(['integrity_check']);

    // An ordinary launch: exactly one structural check, and no ledger scan behind it.
    asked.length = 0;
    await openSafely({ database, snapshots: memorySnapshots(), onStage: () => undefined });
    expect(asked).toEqual(['quick_check']);
  });

  /**
   * The guard above, wired: the decision is only worth anything if the opener actually asks it. A pure
   * function with a test beside it proved the arithmetic and nothing else — deleting `quickCheckAffordable`
   * from `open.ts` left every unit test in this app green, so "size-guarded" was a claim about code nobody
   * was checking. This test drives `openSafely` against a database that *says* it is past the limit.
   */
  it('asks a database too big to check on the way in nothing at all, and a smaller one the usual question', async () => {
    executor = createNodeExecutor();
    const inner = executor;
    const asked: string[] = [];
    // The size the file claims, in pages of `PAGE`. Both are derived from the exported limit: a literal here
    // would go stale the day the limit moves, and pass for the wrong reason.
    const PAGE = 4096;
    let pages = Math.ceil(QUICK_CHECK_LIMIT_BYTES / PAGE) + 1;
    const watching: SqlExecutor = {
      query: (sql, params, method) => {
        const pragma = /PRAGMA\s+(quick_check|integrity_check)/i.exec(sql);
        if (pragma) asked.push(pragma[1]!.toLowerCase());
        // The two pragmas the size guard reads, answered for a file of the size this test wants.
        if (/PRAGMA\s+page_count/i.test(sql)) return Promise.resolve([[pages]]);
        if (/PRAGMA\s+page_size/i.test(sql)) return Promise.resolve([[PAGE]]);
        return inner.query(sql, params, method);
      },
      execScript: (sql) => inner.execScript(sql),
      exportBytes: () => inner.exportBytes(),
      importBytes: (bytes) => inner.importBytes(bytes),
    };
    const database = createDatabase(watching);
    await migrate(database);

    // One byte past the limit: the check that sits before first paint is given up, exactly as §11.4 allows.
    await openSafely({ database, snapshots: memorySnapshots(), onStage: () => undefined });
    expect(asked).toEqual([]);

    // And the same launch of the same database, one page smaller, is still checked — so the empty answer
    // above is the guard's doing and not a test that quietly stopped opening anything.
    asked.length = 0;
    pages = Math.floor(QUICK_CHECK_LIMIT_BYTES / PAGE) - 1;
    await openSafely({ database, snapshots: memorySnapshots(), onStage: () => undefined });
    expect(asked).toEqual(['quick_check']);
  });

  it('gives the pre-open check up on a database too big to check before first paint', () => {
    // The guard §11.4 asked for, as a decision anyone can read: a file this side of the limit is checked,
    // one past it waits for an update to earn the wait, and one that will not say is checked regardless.
    expect(quickCheckAffordable(1_372_160)).toBe(true);
    expect(quickCheckAffordable(QUICK_CHECK_LIMIT_BYTES)).toBe(true);
    expect(quickCheckAffordable(QUICK_CHECK_LIMIT_BYTES + 1)).toBe(false);
    expect(quickCheckAffordable(null)).toBe(true);
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

  /**
   * Spec §5.3's rollback, over the engine the app really runs on — the worker executor, with §3.4's strike
   * armed inside it.
   *
   * A post-migration `integrity_check` that answers "malformed" is the case the strike was written for and
   * the case the rollback was written for, at the same moment. If the strike wins, `importBytes` is refused
   * on the main thread without ever reaching the worker, and the user is left on a half-updated file with a
   * good copy of the old one sitting right there. The bytes go back instead: a database that failed its
   * post-migration check is exactly when putting them back matters most.
   */
  it('still puts the database back when the check after the update comes back malformed', async () => {
    executor = createNodeExecutor();
    const inner = executor;
    const malformed = 'database disk image is malformed';
    const holed: SqlExecutor = {
      query: (sql, params, method) =>
        /PRAGMA\s+integrity_check/i.test(sql) ? Promise.reject(new Error(malformed)) : inner.query(sql, params, method),
      execScript: (sql) => inner.execScript(sql),
      exportBytes: () => inner.exportBytes(),
      importBytes: (bytes) => inner.importBytes(bytes),
    };
    const worker = workerOver(holed);
    const wx = createWorkerExecutor(worker as unknown as Worker);
    const database = createDatabase(wx);
    await migrate(
      database,
      MIGRATIONS.filter((m) => m.version <= 45),
    );
    const before = await database.exportBytes();
    const store = memorySnapshots();

    const result = await openSafely({ database, snapshots: store, onStage: () => undefined, snapshotBytes: () => wx.snapshotBytes() });

    expect(result.ok).toBe(false);
    // Not `rolledBack: false` on a half-updated file: the copy taken minutes earlier really went back.
    if (!result.ok) expect(result.reason).toMatchObject({ kind: 'verify-failed', rolledBack: true });
    expect(worker.ops).toContain('import');
    expect(await databaseVersion(database)).toBe(45);
    expect(Array.from(await database.exportBytes())).toEqual(Array.from(before));
    expect(await store.blockedVersion()).toBe(46);
  });

  /**
   * The open path, over a worker whose module never evaluated.
   *
   * A precached worker chunk that has gone bad, a module fetch that fails on the first load after an
   * update, an uncaught top-level throw: `self.onmessage` is never installed, so no message is ever
   * answered and `worker.onerror` is the only thing the browser says about it. The strike records the
   * fatal and rejects what is pending — and then `databaseVersion`'s catch asks `checkStructure`, which
   * posts a second query. Gated behind `armed`, that post was accepted by an engine that could not answer
   * it: `openSafely` never returned, `bootstrap` never returned, and `main.tsx` was left awaiting a
   * bootstrap that never finished, with the opening screen on the page and no button on it.
   *
   * The race is the assertion. Without the unconditional refusal this test does not fail, it hangs — which
   * is the defect, stated as precisely as it can be stated.
   */
  it('reaches a recovery screen rather than the opening screen for ever, when the worker never evaluates', async () => {
    const posted: string[] = [];
    const worker = {
      onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
      onerror: null as ((event: ErrorEvent) => void) | null,
      terminate: () => undefined,
      postMessage(message: { op: string }) {
        posted.push(message.op);
        // The browser's one signal about a worker whose module threw on the way up. Nothing is ever replied to.
        if (posted.length === 1) setTimeout(() => worker.onerror?.({ message: 'Failed to fetch worker module' } as ErrorEvent), 0);
      },
    };
    const wx = createWorkerExecutor(worker as unknown as Worker);
    const database = createDatabase(wx);

    const outcome = await Promise.race([
      openSafely({ database, snapshots: NO_SNAPSHOTS, onStage: () => undefined }).then((r) => (r.ok ? 'ok' : `reason:${r.reason.kind}`)),
      new Promise<string>((resolve) => setTimeout(() => resolve('HUNG'), 1_000)),
    ]);

    expect(outcome).not.toBe('HUNG');
    // A typed reason, with Export, Restore and Try again on the screen it draws.
    expect(outcome).toBe('reason:corrupt');
    // The second post is the point: nothing is issued to an engine that has already gone.
    expect(posted).toHaveLength(1);
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

  /**
   * A block is only worth having if the app can really run at the version below it.
   *
   * `allowed` stops one short of the blocked update, and then every repo in this build — written against
   * this build's schema — runs on a file one version behind it. That holds for today's newest migration
   * because it only adds tables, and nothing said so out loud: the day someone adds a column an opening
   * read selects, a block on that migration stops being "open one version behind" and becomes
   * `cannot-open`, on the one device that has already had an update go wrong. So this opens with the real
   * newest migration blocked and then uses the app: seeding, the catalogue sync, an account written and
   * read back. Nothing here is a literal — it is whatever this build's newest migration happens to be.
   */
  it('opens and works one version behind, when this build’s own newest update is the blocked one', async () => {
    executor = createNodeExecutor();
    const database = createDatabase(executor);
    const store = memorySnapshots();
    // The shape a device is left in by an update of this build that failed once and was put back.
    await store.block(LATEST_VERSION, LATEST_VERSION);

    const result = await openSafely({ database, snapshots: store, onStage: () => undefined });

    expect(result.ok).toBe(true);
    expect(await databaseVersion(database)).toBe(PREVIOUS_VERSION);
    if (!result.ok) return;
    expect(result.app.update).toMatchObject({ blocked: LATEST_VERSION });
    // Not merely open: usable. `openAppDb` has already seeded categories and synced the catalogue against
    // this older schema; a write and a read prove the repos of this build still speak to it.
    const account = await createAccount(database, result.app.ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    expect((await listAccounts(database, result.app.ws)).some((a) => a.id === account.id)).toBe(true);
  });

  it('lifts the block when a build arrives with migrations past the one that failed, and forgets it', async () => {
    const store = memorySnapshots();
    await store.block(NEXT, LATEST_VERSION);
    expect(await store.blockedVersion()).toBe(NEXT); // asked with no build: whatever is on the device
    expect(await store.blockedVersion(LATEST_VERSION)).toBe(NEXT); // the build that set it, still held
    // A build that ships one migration more is a different build: the update it was told not to attempt was
    // that older app's judgement, and holding it would keep a fixed migration out for ever.
    expect(await store.blockedVersion(LATEST_VERSION + 1)).toBe(null);
    // And the record goes with it. Left on the device it would go on telling the card above the page that
    // an update is being skipped, on a device where that update went in long ago and nothing would clear it.
    expect(await store.blockedVersion()).toBe(null);
  });

  it('runs the update anyway when the record names a version no build could skip', async () => {
    const files = new Map<string, Uint8Array>();
    const store = memorySnapshots(files);
    // Honouring a block at version 0 would filter every migration out of the run and open an app with no
    // schema in it at all — far worse than attempting the update it claims to skip.
    files.set(MANIFEST, new TextEncoder().encode(`{"snapshots":[],"blockedVersion":0,"blockedBuild":${LATEST_VERSION}}`));

    executor = createNodeExecutor();
    const database = createDatabase(executor);
    const result = await openSafely({ database, snapshots: store, onStage: () => undefined });

    expect(result.ok).toBe(true);
    expect(await databaseVersion(database)).toBe(LATEST_VERSION);
    if (result.ok) expect(result.app.update).toMatchObject({ blocked: null });
  });

  it('opens, and says out loud, when the record of blocked updates cannot be read', async () => {
    executor = createNodeExecutor();
    const database = createDatabase(executor);
    const store = memorySnapshots();
    store.blockedVersion = async () => {
      throw new Error('the manifest would not read');
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await openSafely({ database, snapshots: store, onStage: () => undefined });

    expect(result.ok).toBe(true);
    // Swallowed silently, this meant a device quietly re-attempting an update it had been told to skip.
    expect(warn.mock.calls.some((call) => String(call[0]).includes('blocked update'))).toBe(true);
    warn.mockRestore();
  });

  it('holds no block that does not say which build set it', async () => {
    const files = new Map<string, Uint8Array>();
    const store = memorySnapshots(files);
    // The shape an older build of this branch wrote: a version, and no record of who decided.
    files.set(MANIFEST, new TextEncoder().encode(`{"snapshots":[],"blockedVersion":${NEXT},"blockedBuild":null}`));
    // It could be lifted by no build and was held against every one of them, for ever.
    expect(await store.blockedVersion(LATEST_VERSION)).toBe(null);
    expect(await store.blockedVersion(LATEST_VERSION + 1)).toBe(null);
    expect(await store.blockedVersion()).toBe(null); // dropped on sight, not merely answered around
  });

  /**
   * Spec §5.1 check 3, the one the branch had never implemented: the update landed.
   *
   * `migrate` writes each version row inside the same transaction as the change it makes, so this is not
   * how an update ordinarily goes wrong — which is exactly why nothing else would catch it. A file left
   * disagreeing with itself about what has run gets migrated again on the next launch, over a schema that
   * already has the change in it, and fails then: long after the copy that could have put it back was
   * pruned. Caught here, the copy is minutes old.
   */
  it('puts the database back when the update finishes without recording everything it ran', async () => {
    const { database } = await seeded();
    const before = await database.exportBytes();
    // A migration that takes an earlier version's row with it: the schema is changed, the record is not.
    const forgetful: Migration = { version: NEXT, name: 'forgetful', sql: 'DELETE FROM schema_migrations WHERE version = 44;' };
    const store = memorySnapshots();

    const result = await openSafely({ database, migrations: [...MIGRATIONS, forgetful], snapshots: store, onStage: () => undefined });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatchObject({ kind: 'verify-failed', rolledBack: true });
      expect(result.reason.detail).toContain('44');
    }
    // Put back byte for byte, at the version it was at before the run.
    expect(await databaseVersion(database)).toBe(45);
    expect(Array.from(await database.exportBytes())).toEqual(Array.from(before));
    expect(await store.blockedVersion()).toBe(46);
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

  /** A Map that remembers the order it was written to and deleted from, which is the whole point below. */
  class Recording extends Map<string, Uint8Array> {
    readonly order: string[] = [];
    override set(key: string, value: Uint8Array) {
      this.order.push(`write ${key}`);
      return super.set(key, value);
    }
    override delete(key: string) {
      this.order.push(`delete ${key}`);
      return super.delete(key);
    }
  }

  it('writes the replacement before it deletes anything, even with room for only one copy', async () => {
    executor = createNodeExecutor();
    const database = createDatabase(executor);
    await migrate(database);
    const bytes = await database.exportBytes();
    const files = new Recording();
    // Room for one more copy but not for three: `prune-first`. It used to mean "delete the older copies
    // first", which left a window — a crash, a full disk, a torn write — with no copy on the device at all.
    const store = memorySnapshots(files, async () => ({ quota: bytes.length * 12, usage: bytes.length * 10 }));

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-17T10:00:00.000Z'));
    const older = await store.write(bytes, 'before-migration', LATEST_VERSION);
    files.order.length = 0;
    vi.setSystemTime(new Date('2026-09-18T10:00:00.000Z'));
    const newest = await store.write(bytes, 'daily', LATEST_VERSION);
    vi.useRealTimers();

    const copies = files.order.filter((step) => step.includes('snapshot-'));
    expect(copies[0]).toBe(`write ${newest.file}`);
    expect(copies).toContain(`delete ${older.file}`);
    expect(copies.indexOf(`write ${newest.file}`)).toBeLessThan(copies.indexOf(`delete ${older.file}`));
    // And the tight case really does prune down to the one copy there is room for.
    expect((await store.list()).map((s) => s.file)).toEqual([newest.file]);
  });

  it('spares a Start fresh copy for seven days even when space is tight', async () => {
    executor = createNodeExecutor();
    const database = createDatabase(executor);
    await migrate(database);
    const bytes = await database.exportBytes();
    const files = new Map<string, Uint8Array>();
    const store = memorySnapshots(files, async () => ({ quota: bytes.length * 12, usage: bytes.length * 10 }));

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-16T10:00:00.000Z'));
    const undo = await store.write(bytes, 'before-start-fresh', LATEST_VERSION);
    vi.setSystemTime(new Date('2026-09-17T10:00:00.000Z'));
    const middle = await store.write(bytes, 'daily', LATEST_VERSION);
    vi.setSystemTime(new Date('2026-09-18T10:00:00.000Z'));
    const newest = await store.write(bytes, 'daily', LATEST_VERSION);
    vi.useRealTimers();

    // The tight path used to sweep everything but the newest, grace and all — and the copy it swept is the
    // only way back for someone who has just wiped the device. The ordinary day's copy goes instead.
    expect((await store.list()).map((s) => s.file).sort()).toEqual([newest.file, undo.file].sort());
    expect(files.has(middle.file)).toBe(false);
  });

  it('lists and prunes a copy the manifest never heard of', async () => {
    const { bytes, files, newest, older, store } = await twoCopies();
    /*
     * A file on the device that no manifest mentions: written just before a crash took the manifest update
     * with it, or left behind by a prune that stopped half way. It used to be invisible — never offered for
     * Restore, and never a candidate for deletion, so it sat there taking room for ever.
     */
    const orphan = snapshotName('2026-09-16T10:00:00.000Z', LATEST_VERSION);
    files.set(orphan, bytes.slice());

    expect((await store.list()).map((s) => s.file)).toContain(orphan);
    // Restorable, not merely listed.
    expect((await store.read(orphan)).length).toBe(bytes.length);

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-19T10:00:00.000Z'));
    const fresh = await store.write(bytes, 'daily', LATEST_VERSION);
    vi.useRealTimers();

    // The oldest two go, the orphan among them, and the manifest is the truth again.
    expect(files.has(orphan)).toBe(false);
    expect(files.has(older.file)).toBe(false);
    expect((await store.list()).map((s) => s.file).sort()).toEqual([fresh.file, newest.file].sort());
  });

  /**
   * The seam between "orphans are listed" and "a copy taken before a restore is never offered as the last
   * good one". Both are right on their own; together they had a hole. `present()` surfaces files the
   * manifest does not name, and the name used to carry no reason, so every orphan was reported as
   * `before-migration` — and a `before-restore` copy whose manifest entry was lost walked straight back
   * into the candidates for "Restore the last good copy". That copy is a copy of whatever was replaced: on
   * the device where the manifest is the thing that broke, the button would have handed back the corruption.
   */
  it('remembers why an orphaned copy was taken, so the undo of a restore is never offered as the last good copy', async () => {
    const { bytes, files, store } = await twoCopies();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-19T10:00:00.000Z'));
    // The newest copy on the device, and the one kind of copy that must never be restored by the big button.
    const undo = await store.write(bytes, 'before-restore', LATEST_VERSION);
    vi.useRealTimers();

    // The manifest goes, exactly as a crash or a half-written file takes it. Everything is an orphan now.
    files.delete(MANIFEST);
    const listed = await store.list();

    // Still listed and still restorable by hand — that promise is untouched.
    expect(listed.map((s) => s.file)).toContain(undo.file);
    expect(listed.find((s) => s.file === undo.file)?.reason).toBe('before-restore');
    // But not the one the screen offers, even though it is the newest thing on the device.
    const good = lastGoodCopy(listed);
    expect(good).not.toBeNull();
    expect(good!.file).not.toBe(undo.file);
  });

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
