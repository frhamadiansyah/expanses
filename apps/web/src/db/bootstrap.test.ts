import { findEntry } from '@expanses/catalog';
import {
  applyCatalogEntry,
  createAccount,
  createDatabase,
  createWorkspace,
  getCatalogState,
  budgetSchema,
  listGoals,
  saveGoal,
  inBook,
  LATEST_VERSION,
  listAccounts,
  listCategorySets,
  listEarnRules,
  listSharedBooks,
  MemoryKeyStore,
  migrate,
  personalBook,
  uncategorisedIdOf,
} from '@expanses/db';
import { sql } from 'drizzle-orm';
import { createNodeExecutor } from '@expanses/db/node';
import { describe, expect, it, vi } from 'vitest';
import { type AppDb, bootstrap, openAppDb } from './bootstrap';
import type { OpenResult } from './open';

/**
 * A worker that does nothing but count the one thing this file cares about. The engine is never started:
 * what is under test is which exits from `bootstrap` let go of the sync access handles a real worker holds.
 */
function fakeWorker() {
  let terminated = 0;
  const worker = {
    postMessage: () => undefined,
    terminate: () => {
      terminated += 1;
    },
  } as unknown as Worker;
  return { worker, released: () => terminated };
}

describe('bootstrap', () => {
  it('releases the worker when the open throws, not only when it returns a failure', async () => {
    const { worker, released } = fakeWorker();
    // `openSafely` reads the version, refuses the future and checks the ledger outside any `try`, so a
    // file that answers one of those with an exception leaves it by throwing rather than returning.
    await expect(
      bootstrap(() => undefined, {
        spawn: () => worker,
        open: async () => {
          throw new Error('SQLITE_IOERR: disk I/O error');
        },
      }),
    ).rejects.toThrow(/disk I\/O error/);
    // Still held, and Restore and Start fresh both meet "modifications are not allowed" on the screen
    // `main.tsx` renders for exactly this throw.
    expect(released()).toBe(1);
  });

  it('releases the worker on a failure it was handed rather than thrown', async () => {
    const { worker, released } = fakeWorker();
    const failure: OpenResult = { ok: false, reason: { kind: 'corrupt', headline: 'no', detail: 'no', exportable: true } };
    const result = await bootstrap(() => undefined, { spawn: () => worker, open: async () => failure });
    expect(result).toBe(failure);
    expect(released()).toBe(1);
  });

  it('keeps the worker when the app actually opens', async () => {
    const { worker, released } = fakeWorker();
    const result = await bootstrap(() => undefined, { spawn: () => worker, open: async () => ({ ok: true, app: {} as AppDb, applied: [] }) });
    expect(result.ok).toBe(true);
    expect(released()).toBe(0);
  });

  /**
   * The way out the React error boundary needs, and the one nothing else provides.
   *
   * A render that throws never reaches `onFatal` — the engine did not complain, a screen did — so nothing
   * strikes and nothing terminates the worker, and the SAH pool goes on holding a sync access handle on
   * every slot file. The recovery screen that replaces the app offers Restore and Start fresh, and both
   * write to those files: without this they fail with "Access Handles cannot be created", which is exactly
   * what the `locked` screen withholds them to avoid.
   */
  it('hands the app a way to let go of the engine, for a screen that crashed with nothing struck', async () => {
    const { worker, released } = fakeWorker();
    const app = {} as AppDb;
    const result = await bootstrap(() => undefined, { spawn: () => worker, open: async () => ({ ok: true, app, applied: [] }) });

    expect(result.ok).toBe(true);
    expect(released()).toBe(0);
    expect(app.release).toBeTypeOf('function');

    app.release?.();
    expect(released()).toBe(1);
    // Safe to call twice: a boundary handling a crash must not be the thing that throws next.
    app.release?.();
    expect(released()).toBe(2);
  });
});

describe('openAppDb', () => {
  it('readies sync before its first write, so a device holding a shared book never mints a stand-in id (final review, I3)', async () => {
    const executor = createNodeExecutor();
    try {
      const database = createDatabase(executor);
      await migrate(database);
      const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
      const book = await personalBook(database, ws);
      // A shared book, restored from a backup onto this device: its keys are not here, and its categories are from
      // before category keys, so the open's ensureCategoryKeys has something to write into it.
      await database.execScript(`UPDATE accounts SET system_key = NULL WHERE subtype = 'category'`);
      await database.db.run(
        sql`INSERT INTO shared_books (book_id, relay_book_id, epoch, member_id, state, shared_at) VALUES (${book.id}, 'relay-1', 1, 'member-1', 'active', '2026-09-01T00:00:00.000Z')`,
      );
      const keyStore = new MemoryKeyStore();
      const app = await openAppDb(database, undefined, { keyStore });
      // The engine was made first (the KeyStore's id is the one seam, §5.1) and the restore was caught (§8.7) before any write.
      expect(await app.sync.deviceId()).toBe((await keyStore.getOrCreateDevice()).deviceId);
      expect((await listSharedBooks(database)).map((b) => b.state)).toEqual(['needs_invite']);
      expect(await database.db.values(sql`SELECT value FROM settings WHERE key = 'sync.device'`)).toEqual([]);
    } finally {
      executor.close();
    }
  });

  it('opens even when the default-category upkeep fails, and leaves it for the next open', async () => {
    const executor = createNodeExecutor();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const database = createDatabase(executor);
      await migrate(database);
      const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
      // Categories from before keys, and no key can be written: the whole of ensureCategoryKeys throws.
      await database.execScript(`UPDATE accounts SET system_key = NULL WHERE subtype = 'category'`);
      await database.execScript(`CREATE TRIGGER refuse_keys BEFORE UPDATE OF system_key ON accounts BEGIN SELECT RAISE(ABORT, 'forced'); END;`);

      const app = await openAppDb(database);
      expect(app.ws.workspaceId).toBe(ws.workspaceId);
      expect(warn).toHaveBeenCalled();
      // The open after carried on past it: the sets were still given.
      expect((await listCategorySets(database, ws)).map((set) => set.name)).toEqual(['Holiday', 'Newborn', 'Renovation']);
    } finally {
      warn.mockRestore();
      executor.close();
    }
  });

  it('opens even when the default category sets cannot be given, and leaves them for the next open', async () => {
    const executor = createNodeExecutor();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const database = createDatabase(executor);
      await migrate(database);
      const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
      // A workspace without its default sets yet, and no set can be written: the whole of ensureDefaultCategorySets throws.
      await database.execScript(`CREATE TRIGGER refuse_sets BEFORE INSERT ON category_sets BEGIN SELECT RAISE(ABORT, 'forced'); END;`);

      const app = await openAppDb(database);
      expect(app.ws.workspaceId).toBe(ws.workspaceId);
      expect(warn).toHaveBeenCalled();
      // One transaction: none of them half-made.
      expect(await listCategorySets(database, ws)).toEqual([]);

      // The next open, with nothing in the way, gives them.
      await database.execScript('DROP TRIGGER refuse_sets');
      await openAppDb(database);
      expect((await listCategorySets(database, ws)).map((set) => set.name)).toEqual(['Holiday', 'Newborn', 'Renovation']);
    } finally {
      warn.mockRestore();
      executor.close();
    }
  });

  it("opens and keys a rule-4 Uncategorised when adding Travel's new children fails", async () => {
    const executor = createNodeExecutor();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const database = createDatabase(executor);
      await migrate(database);
      const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
      const book = await personalBook(database, ws);
      // A workspace from before Transport, Souvenirs and Others, holding household sync's unkeyed Uncategorised.
      await database.execScript(`
        DELETE FROM book_categories WHERE category_account_id IN (SELECT id FROM accounts WHERE system_key IN ('travel.transport', 'travel.souvenirs', 'travel.meals', 'travel.others'));
        DELETE FROM accounts WHERE system_key IN ('travel.transport', 'travel.souvenirs', 'travel.meals', 'travel.others');`);
      const ruleFour = await uncategorisedIdOf(book.id, 'expense');
      await database.execScript(`
        INSERT INTO accounts (id, workspace_id, parent_id, kind, subtype, name, valuation_mode, sort_order, created_at)
          VALUES ('${ruleFour}', '${ws.workspaceId}', NULL, 'expense', 'category', 'Uncategorised', 'derived', 999, '2026-10-01T00:00:00Z');
        INSERT INTO book_categories (category_account_id, workspace_id, book_id) VALUES ('${ruleFour}', '${ws.workspaceId}', '${book.id}');
        CREATE TRIGGER refuse_travel BEFORE INSERT ON accounts WHEN NEW.system_key LIKE 'travel.%' BEGIN SELECT RAISE(ABORT, 'forced'); END;`);

      await openAppDb(database);
      const accounts = await listAccounts(database, ws);
      expect(accounts.find((a) => a.id === ruleFour)?.systemKey).toBe('uncategorised');
      expect(accounts.filter((a) => a.systemKey === 'travel.transport')).toEqual([]);
      expect(warn).toHaveBeenCalled();

      // The next open, with nothing in the way, adds them.
      await database.execScript('DROP TRIGGER refuse_travel');
      await openAppDb(database);
      expect((await listAccounts(database, ws)).filter((a) => a.systemKey === 'travel.transport')).toHaveLength(1);
    } finally {
      warn.mockRestore();
      executor.close();
    }
  });

  it('migrates a database of its own, up to the newest schema the build carries', async () => {
    const executor = createNodeExecutor();
    try {
      // Nothing has run here: the app opens an empty file the way it does on a first visit.
      const app = await openAppDb(createDatabase(executor));
      const [version] = (await executor.query('SELECT max(version) FROM schema_migrations', [], 'get')) as [number];
      // The newest migration this build carries; a browser that stops short of it is running stale schema.
      // Derived, never a literal: migration numbers may skip, so the newest is not the count of them.
      expect(Number(version)).toBe(LATEST_VERSION);
      expect(await migrate(app.database)).toEqual([]);
      expect((await listAccounts(app.database, app.ws)).some((a) => a.subtype === 'category')).toBe(true);
    } finally {
      executor.close();
    }
  });

  it('keys default categories before syncing linked catalogue programs', async () => {
    const executor = createNodeExecutor();
    try {
      const database = createDatabase(executor);
      await migrate(database);
      const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
      // A workspace from before category keys, linked to an older version of the entry.
      await database.execScript(`UPDATE accounts SET system_key = NULL WHERE subtype = 'category'`);
      const card = await createAccount(database, ws, { name: 'BCA KrisFlyer', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
      const older = { ...findEntry('bca-sq-krisflyer-visa-signature')!, entryVersion: 0 };
      const { programId, unmappedKeys } = await applyCatalogEntry(database, ws, { cardAccountId: card.id, entry: older, today: '2026-09-11', replaceManual: false });
      // Seven now: Obligation is excluded alongside Charity, so the rule names one key more.
      expect(unmappedKeys).toHaveLength(7);

      const app = await openAppDb(database);
      expect(app.ws).toEqual(inBook(ws, (await personalBook(database, ws)).id));
      expect((await listAccounts(database, ws)).find((a) => a.name === 'Groceries')?.systemKey).toBe('household.groceries');
      expect(await getCatalogState(database, ws, programId)).toMatchObject({ entryVersion: findEntry('bca-sq-krisflyer-visa-signature')!.entryVersion, status: 'linked' });
      for (const rule of await listEarnRules(database, ws, programId)) expect(rule.match.excludeCategoryIds).toHaveLength(7);

      // Sets arrive with the feature, so a workspace made before it has them after one open.
      expect((await listCategorySets(database, ws)).map((set) => set.name)).toEqual(['Holiday', 'Newborn', 'Renovation']);
      expect((await listAccounts(database, ws)).filter((a) => a.name === 'Diapering')).toHaveLength(1);
    } finally {
      executor.close();
    }
  });

  it('states a goal worked out before in today’s money, once, on open', async () => {
    const executor = createNodeExecutor();
    try {
      const database = createDatabase(executor);
      await migrate(database);
      const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
      const goalId = await saveGoal(database, ws, {
        name: 'Retirement', kind: 'retirement', growthBps: 400, returnBps: 900, derived: true,
        stages: [{ name: 'Retirement fund', targetMinor: 4_120_008_061, targetMonths: null, dueOn: '2046-09-21' }],
      });
      await database.db.insert(budgetSchema.goalCalculators).values({
        goalId, workspaceId: ws.workspaceId, kind: 'retirement', computedMinor: 4_120_008_061, computedAt: '2026-09-21T00:00:00.000Z',
        inputsJson: JSON.stringify({ annualSpendTodayMinor: 120_000_000, yearsToRetirement: 20, yearsInRetirement: 20, inflationBps: 350, returnInRetirementBps: 500 }),
      });

      await openAppDb(database);
      expect((await listGoals(database, ws))[0]).toMatchObject({ growthBps: 350, stages: [{ targetMinor: 2_070_575_495 }] });
    } finally {
      executor.close();
    }
  });

  it('states worked-out goals in today’s money in every workspace, not only the one it opens', async () => {
    const executor = createNodeExecutor();
    try {
      const database = createDatabase(executor);
      await migrate(database);
      const oldRetirement = async (name: string) => {
        const ws = await createWorkspace(database, { name, type: 'personal', baseCurrency: 'IDR' });
        const goalId = await saveGoal(database, ws, {
          name: 'Retirement', kind: 'retirement', growthBps: 400, returnBps: 900, derived: true,
          stages: [{ name: 'Retirement fund', targetMinor: 4_120_008_061, targetMonths: null, dueOn: '2046-09-21' }],
        });
        await database.db.insert(budgetSchema.goalCalculators).values({
          goalId, workspaceId: ws.workspaceId, kind: 'retirement', computedMinor: 4_120_008_061, computedAt: '2026-09-21T00:00:00.000Z',
          inputsJson: JSON.stringify({ annualSpendTodayMinor: 120_000_000, yearsToRetirement: 20, yearsInRetirement: 20, inflationBps: 350, returnInRetirementBps: 500 }),
        });
        return ws;
      };
      const first = await oldRetirement('Personal');
      const second = await oldRetirement('Family');

      const app = await openAppDb(database);
      expect(app.workspaceName).toBe('Personal');
      for (const ws of [first, second]) {
        expect((await listGoals(database, ws))[0], ws.workspaceId).toMatchObject({ growthBps: 350, stages: [{ targetMinor: 2_070_575_495 }] });
      }
    } finally {
      executor.close();
    }
  });
});
