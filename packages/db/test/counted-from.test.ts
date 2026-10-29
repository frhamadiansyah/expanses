import { beforeEach, describe, expect, it } from 'vitest';
import { createAccount, listCountedFrom, MIGRATIONS, nativeBalances, setCountedFrom, type Database, type WorkspaceContext } from '../src/index';
import { setupDb } from './helpers';

/** "Counted from" (0107): the As of day of a money account opened at nothing. Null until chosen; never moves a balance. */

let database: Database;
let ws: WorkspaceContext;

beforeEach(async () => {
  ({ database, ws } = await setupDb());
});

const wallet = () => createAccount(database, ws, { name: 'GoPay', kind: 'asset', subtype: 'ewallet', currency: 'IDR' });

describe('migration 0107', () => {
  it('is version 107 and named account_counted_from', () => {
    expect(MIGRATIONS.find((m) => m.version === 107)).toMatchObject({ name: 'account_counted_from' });
  });
});

describe('counted from', () => {
  it('is unset until chosen, keeps the day chosen, and is cleared with null; the balance never moves', async () => {
    const gopay = await wallet();
    expect(await listCountedFrom(database, ws)).toEqual({});
    await setCountedFrom(database, ws, gopay.id, '2026-03-01', '2026-10-29');
    expect(await listCountedFrom(database, ws)).toEqual({ [gopay.id]: '2026-03-01' });
    await setCountedFrom(database, ws, gopay.id, '2026-10-29', '2026-10-29');
    expect(await listCountedFrom(database, ws)).toEqual({ [gopay.id]: '2026-10-29' });
    expect((await nativeBalances(database, ws))[gopay.id] ?? 0).toBe(0);
    await setCountedFrom(database, ws, gopay.id, null, '2026-10-29');
    expect(await listCountedFrom(database, ws)).toEqual({});
  });

  it('refuses a day after today, a non-date, and an account that has an opening entry', async () => {
    const gopay = await wallet();
    await expect(setCountedFrom(database, ws, gopay.id, '2026-10-30', '2026-10-29')).rejects.toThrow(/after today/);
    await expect(setCountedFrom(database, ws, gopay.id, 'soon', '2026-10-29')).rejects.toThrow(/date/);
    const cash = await createAccount(database, ws, { name: 'Cash', kind: 'asset', subtype: 'cash', currency: 'IDR', openingBalanceMinor: 100_000, openedOn: '2026-01-01' });
    await expect(setCountedFrom(database, ws, cash.id, '2026-02-01', '2026-10-29')).rejects.toThrow(/opening/);
  });
});
