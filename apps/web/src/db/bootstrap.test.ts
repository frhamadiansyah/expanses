import { findEntry } from '@expanses/catalog';
import {
  applyCatalogEntry,
  createAccount,
  createDatabase,
  createWorkspace,
  getCatalogState,
  inBook,
  listAccounts,
  listCategorySets,
  listEarnRules,
  migrate,
  personalBook,
} from '@expanses/db';
import { createNodeExecutor } from '@expanses/db/node';
import { describe, expect, it } from 'vitest';
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
});

describe('openAppDb', () => {
  it('migrates a database of its own, up to the newest schema the build carries', async () => {
    const executor = createNodeExecutor();
    try {
      // Nothing has run here: the app opens an empty file the way it does on a first visit.
      const app = await openAppDb(createDatabase(executor));
      const [version] = (await executor.query('SELECT max(version) FROM schema_migrations', [], 'get')) as [number];
      // 47 is cash_equivalents, the newest migration; a browser that stops short of it is running stale schema.
      expect(Number(version)).toBe(47);
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
});
