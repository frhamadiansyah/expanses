import { beforeEach, describe, expect, it } from 'vitest';
import {
  acquiredDates,
  changeAcquired,
  createAccount,
  type Database,
  getAssetProfile,
  nativeBalances,
  openingsOf,
  saveAcquired,
  saveAssetProfile,
  type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';

let database: Database;
let ws: WorkspaceContext;

beforeEach(async () => {
  ({ database, ws } = await setupDb());
});

async function car(openedOn: string, currency = 'IDR', openingRateToBase?: number) {
  const account = await createAccount(database, ws, { name: 'Passenger car', kind: 'asset', subtype: 'vehicle', currency, openingBalanceMinor: 215_000_000, openedOn, openingRateToBase });
  await saveAssetProfile(database, ws, { accountId: account.id, assetKind: 'vehicle', coretaxSection: 'bergerak', coretaxCode: '0403', acquiredYear: Number(openedOn.slice(0, 4)) });
  return account;
}

describe('when an asset was acquired', () => {
  it('keeps how much of the day was typed, and nothing for an asset never given one', async () => {
    const a = await car('2021-01-01');
    const b = await car('2022-03-14');
    await saveAcquired(database, ws, a.id, { on: '2021-01-01', precision: 'year' });
    expect(await acquiredDates(database, ws)).toEqual({ [a.id]: { on: '2021-01-01', precision: 'year' } });
    expect((await acquiredDates(database, ws))[b.id]).toBeUndefined();
  });

  it('moves the opening entry, the tax year and the precision together on Edit', async () => {
    const account = await car('2021-01-01');
    await saveAcquired(database, ws, account.id, { on: '2021-01-01', precision: 'year' });

    await changeAcquired(database, ws, account.id, { on: '2019-06-01', precision: 'month' }, '2026-10-19');

    expect((await openingsOf(database, ws, [account.id]))[account.id]).toMatchObject({ occurredOn: '2019-06-01', amountMinor: 215_000_000 });
    expect((await getAssetProfile(database, ws, account.id))?.acquiredYear).toBe(2019);
    expect((await acquiredDates(database, ws))[account.id]).toEqual({ on: '2019-06-01', precision: 'month' });
    // The balance did not change, and nothing sits on the old day any more.
    expect((await nativeBalances(database, ws))[account.id]).toBe(215_000_000);
    expect((await nativeBalances(database, ws, '2020-12-31'))[account.id]).toBe(215_000_000);
  });

  it('keeps a foreign opening at the rate it was posted at', async () => {
    const account = await car('2024-05-10', 'USD', 16_000);
    const before = (await openingsOf(database, ws, [account.id]))[account.id]!;
    await changeAcquired(database, ws, account.id, { on: '2024-01-01', precision: 'year' }, '2026-10-19');
    const after = (await openingsOf(database, ws, [account.id]))[account.id]!;
    expect(after).toEqual({ ...before, occurredOn: '2024-01-01' });
  });

  it('dates an asset with no cost yet without posting anything', async () => {
    const account = await createAccount(database, ws, { name: 'Land', kind: 'asset', subtype: 'property', currency: 'IDR' });
    await saveAssetProfile(database, ws, { accountId: account.id, assetKind: 'property' });
    await changeAcquired(database, ws, account.id, { on: '2015-01-01', precision: 'year' }, '2026-10-19');
    expect(await openingsOf(database, ws, [account.id])).toEqual({});
    expect((await getAssetProfile(database, ws, account.id))?.acquiredYear).toBe(2015);
  });

  it('refuses a day after today', async () => {
    const account = await car('2021-01-01');
    await expect(changeAcquired(database, ws, account.id, { on: '2027-01-01', precision: 'year' }, '2026-10-19')).rejects.toThrow(/after today/);
  });
});
