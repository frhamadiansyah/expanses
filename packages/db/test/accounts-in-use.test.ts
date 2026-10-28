import { afterEach, describe, expect, it } from 'vitest';
import { accountIdsInUse, createAccount } from '../src/index';
import { setupDb, type TestDb } from './helpers';

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

describe('accountIdsInUse', () => {
  it('lists an account with an entry on any date, and leaves out one nothing was recorded on', async () => {
    current = await setupDb();
    const { database, ws } = current;
    const used = await createAccount(database, ws, { name: 'Wallet cash', kind: 'asset', subtype: 'cash', currency: 'IDR', openingBalanceMinor: 50_000, openedOn: '2020-01-01' });
    const empty = await createAccount(database, ws, { name: 'Cash IDR', kind: 'asset', subtype: 'cash', currency: 'IDR', openingBalanceMinor: 0, openedOn: '2026-09-01' });
    const ids = await accountIdsInUse(database, ws);
    expect(ids).toContain(used.id);
    expect(ids).not.toContain(empty.id);
  });
});
