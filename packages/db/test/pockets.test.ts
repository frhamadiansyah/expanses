import { beforeEach, describe, expect, it } from 'vitest';
import {
  addPocket,
  type Database,
  getAssetProfile,
  listAccounts,
  nativeBalances,
  openCashAccount,
  openingsOf,
  openPocketedAccount,
  pocketName,
  pocketParentIds,
  type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';

let database: Database;
let ws: WorkspaceContext;
beforeEach(async () => {
  ({ database, ws } = await setupDb());
});

/** The mockup's account. SGD opens at a rate with a fraction, so a rate stored as a whole number is caught. */
const valas = () =>
  openPocketedAccount(database, ws, {
    item: 'savings',
    name: 'BCA Pocket Valas',
    bank: 'BCA',
    openedOn: '2025-02-04',
    pockets: [
      { currency: 'USD', openingBalanceMinor: 240_000, openingRateToBase: 15_940 },
      { currency: 'SGD', openingBalanceMinor: 115_000, openingRateToBase: 12_110.5 },
      { currency: 'IDR', openingBalanceMinor: 5_400_000 },
    ],
  });

describe('opening an account with pockets', () => {
  it('writes a parent that holds nothing and one ordinary money account per currency', async () => {
    const { parent, pockets } = await valas();
    expect(parent).toMatchObject({ kind: 'asset', subtype: 'savings', currency: 'IDR', parentId: null, name: 'BCA Pocket Valas' });
    expect(await getAssetProfile(database, ws, parent.id)).toBeUndefined();
    expect(pockets.map((p) => [p.name, p.currency, p.subtype, p.parentId])).toEqual([
      ['BCA Pocket Valas · USD', 'USD', 'savings', parent.id],
      ['BCA Pocket Valas · SGD', 'SGD', 'savings', parent.id],
      ['BCA Pocket Valas · IDR', 'IDR', 'savings', parent.id],
    ]);
    const balances = await nativeBalances(database, ws);
    expect(balances[parent.id]).toBeUndefined();
    expect(pockets.map((p) => balances[p.id])).toEqual([240_000, 115_000, 5_400_000]);
    // Each pocket is filed as the kind of account it is, with the bank on its own kas row.
    const profile = await getAssetProfile(database, ws, pockets[0]!.id);
    expect(profile).toMatchObject({ coretaxSection: 'kas', coretaxCode: '0102' });
    expect(profile!.coretaxFields).toEqual({ inst: 'BCA' });
    expect(pocketParentIds(await listAccounts(database, ws))).toEqual(new Set([parent.id]));
    // The order they were given is kept in sort_order: ids made in the same millisecond are not ordered (uuidv7
    // here has no counter), so "the order they were added" cannot be read off the id.
    expect(pockets.map((p) => p.sortOrder)).toEqual([0, 1, 2]);
  });

  it('keeps the rate each opening balance was posted at', async () => {
    const { pockets } = await valas();
    const openings = await openingsOf(database, ws, pockets.map((p) => p.id));
    expect(openings[pockets[0]!.id]).toEqual({ occurredOn: '2025-02-04', amountMinor: 240_000, currency: 'USD', fxRateToBase: 15_940 });
    expect(openings[pockets[1]!.id]!.fxRateToBase).toBe(12_110.5);
    expect(openings[pockets[2]!.id]!.fxRateToBase).toBe(1);
  });

  it('refuses one currency twice, fewer than two pockets, and a time deposit — leaving nothing behind', async () => {
    const before = (await listAccounts(database, ws)).length;
    await expect(
      openPocketedAccount(database, ws, { item: 'savings', name: 'Twice', pockets: [{ currency: 'USD' }, { currency: 'USD' }] }),
    ).rejects.toThrow('USD is listed twice');
    await expect(openPocketedAccount(database, ws, { item: 'savings', name: 'One', pockets: [{ currency: 'USD' }] })).rejects.toThrow('at least two currencies');
    await expect(
      openPocketedAccount(database, ws, { item: 'time_deposit', name: 'Deposit', pockets: [{ currency: 'USD' }, { currency: 'SGD' }] }),
    ).rejects.toThrow('A time deposit holds one currency');
    // A pocket that fails half-way (no rate for its opening balance) takes the parent and the first pocket with it.
    await expect(
      openPocketedAccount(database, ws, {
        item: 'savings',
        name: 'Half',
        pockets: [{ currency: 'IDR', openingBalanceMinor: 1_000 }, { currency: 'USD', openingBalanceMinor: 1_000 }],
      }),
    ).rejects.toThrow();
    expect((await listAccounts(database, ws)).length).toBe(before);
  });
});

describe('adding a pocket', () => {
  it('files it under the parent’s kind, with the bank its first pocket has', async () => {
    const { parent } = await valas();
    const jpy = await addPocket(database, ws, { parentId: parent.id, currency: 'JPY', openingBalanceMinor: 30_000, openedOn: '2026-09-21', openingRateToBase: 108.3 });
    expect(jpy).toMatchObject({ name: 'BCA Pocket Valas · JPY', currency: 'JPY', subtype: 'savings', parentId: parent.id, sortOrder: 3 });
    expect((await getAssetProfile(database, ws, jpy.id))!.coretaxFields).toEqual({ inst: 'BCA' });
    expect((await nativeBalances(database, ws))[jpy.id]).toBe(30_000);
  });

  it('refuses a currency the account already has, and an account with no pockets', async () => {
    const { parent } = await valas();
    await expect(addPocket(database, ws, { parentId: parent.id, currency: 'USD' })).rejects.toThrow('already has a USD pocket');
    const plain = await openCashAccount(database, ws, { item: 'savings', name: 'Mandiri Valas', currency: 'USD', openingBalanceMinor: 180_000, openingRateToBase: 15_720 });
    await expect(addPocket(database, ws, { parentId: plain.id, currency: 'SGD' })).rejects.toThrow('has no pockets');
  });
});

describe('names', () => {
  it('name the bank and the currency', () => {
    expect(pocketName('BCA Pocket Valas', 'USD')).toBe('BCA Pocket Valas · USD');
  });

  it('only a money account named as a parent is one — categories are not', () => {
    const rows = [
      { id: 'p', parentId: null, kind: 'asset' },
      { id: 'usd', parentId: 'p', kind: 'asset' },
      { id: 'food', parentId: null, kind: 'expense' },
      { id: 'dining', parentId: 'food', kind: 'expense' },
    ] as const;
    expect(pocketParentIds(rows)).toEqual(new Set(['p']));
  });
});
