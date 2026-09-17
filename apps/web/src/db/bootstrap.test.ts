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
import { openAppDb } from './bootstrap';

describe('openAppDb', () => {
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
