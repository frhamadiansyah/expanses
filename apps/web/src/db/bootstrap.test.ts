import { findEntry } from '@expanses/catalog';
import { applyCatalogEntry, createAccount, createDatabase, createWorkspace, getCatalogState, listAccounts, listEarnRules, migrate } from '@expanses/db';
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
      expect(unmappedKeys).toHaveLength(6);

      const app = await openAppDb(database);
      expect(app.ws).toEqual(ws);
      expect((await listAccounts(database, ws)).find((a) => a.name === 'Groceries')?.systemKey).toBe('food.groceries');
      expect(await getCatalogState(database, ws, programId)).toMatchObject({ entryVersion: findEntry('bca-sq-krisflyer-visa-signature')!.entryVersion, status: 'linked' });
      for (const rule of await listEarnRules(database, ws, programId)) expect(rule.match.excludeCategoryIds).toHaveLength(6);
    } finally {
      executor.close();
    }
  });
});
