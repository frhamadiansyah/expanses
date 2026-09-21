import { exchangeCost, exchangeLines, transferLines } from '@expanses/core';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addPocket,
  archiveAccount,
  assetValuesAt,
  coretaxInputsFor,
  type Database,
  getAssetProfile,
  listAccounts,
  nativeBalances,
  netWorthAt,
  openCashAccount,
  openingsOf,
  openPocketedAccount,
  periodFlows,
  pocketName,
  pocketParentIds,
  postTransaction,
  renameAccount,
  schema,
  systemAccountId,
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


describe('the parent holds no money', () => {
  it('refuses any posting that touches it, before writing anything', async () => {
    const { parent, pockets } = await valas();
    const txCount = async () => (await database.db.select().from(schema.transactions)).length;
    const before = await txCount();
    await expect(
      postTransaction(database, ws, { occurredOn: '2026-09-21', description: 'Into the parent', lines: transferLines({ fromAccountId: pockets[2]!.id, toAccountId: parent.id, amountMinor: 1_000, currency: 'IDR' }) }),
    ).rejects.toMatchObject({ code: 'POCKET_PARENT', message: 'BCA Pocket Valas holds no money of its own. Choose one of its pockets.' });
    expect(await txCount()).toBe(before);
  });

  it('is archived only after its pockets', async () => {
    const { parent } = await valas();
    await expect(archiveAccount(database, ws, parent.id)).rejects.toThrow('BCA Pocket Valas still has pockets: USD, SGD, IDR. Archive each pocket first.');
  });

  it('renames the pockets still named after it, and leaves a renamed pocket alone', async () => {
    const { parent, pockets } = await valas();
    await renameAccount(database, ws, pockets[1]!.id, 'My Singapore money');
    await renameAccount(database, ws, parent.id, 'OCBC Multi');
    const names = new Map((await listAccounts(database, ws)).map((a) => [a.id, a.name]));
    expect([names.get(parent.id), names.get(pockets[0]!.id), names.get(pockets[1]!.id), names.get(pockets[2]!.id)]).toEqual([
      'OCBC Multi',
      'OCBC Multi · USD',
      'My Singapore money',
      'OCBC Multi · IDR',
    ]);
  });
});

describe('what the parent is worth to every reader', () => {
  it('is nothing: net worth and the asset list see each pocket once and the parent never', async () => {
    const { parent, pockets } = await valas();
    const values = await assetValuesAt(database, ws, '2026-09-21');
    // THE assertion that fails before Step 5: today the parent is returned as a 0-valued row, which idle cash and
    // goal funding would list. The net-worth and daftar-harta checks below pass today too (a parent holds 0, and
    // the kas table skips a balance ≤ 0); they guard the figures, they do not prove the filter.
    expect(values.some((row) => row.accountId === parent.id)).toBe(false);
    // Rows come in (sort_order, name) order; the pockets' sort_order 0,1,2 is what makes this USD, SGD, IDR — by name
    // alone it would be IDR, SGD, USD.
    expect(values.filter((row) => pockets.some((p) => p.id === row.accountId)).map((row) => [row.currency, row.valueMinor])).toEqual([
      ['USD', 240_000],
      ['SGD', 115_000],
      ['IDR', 5_400_000],
    ]);
    // The mockup's total, at the mockup's rates — not the opening rates, and not the parent counted on top.
    expect((await netWorthAt(database, ws, '2026-09-21', { USD: 16_250, SGD: 12_680 })).assetsMinor).toBe(58_982_000);
  });

  it('puts one kas row per pocket on daftar harta, and none for the parent', async () => {
    const { parent, pockets } = await valas();
    const inputs = await coretaxInputsFor(database, ws, 2026);
    expect(inputs.cash.some((row) => row.accountId === parent.id)).toBe(false);
    expect(inputs.cash.map((row) => [row.accountId, row.name, row.code, row.currency, row.balanceMinor])).toEqual([
      [pockets[0]!.id, 'BCA Pocket Valas · USD', '0102', 'USD', 240_000],
      [pockets[1]!.id, 'BCA Pocket Valas · SGD', '0102', 'SGD', 115_000],
      [pockets[2]!.id, 'BCA Pocket Valas · IDR', '0102', 'IDR', 5_400_000],
    ]);
  });
});

describe('a move between pockets', () => {
  const moveUsdToSgd = async () => {
    const { pockets } = await valas();
    const exchangeId = await systemAccountId(database.db, ws, 'currency_exchange');
    const id = await postTransaction(database, ws, {
      occurredOn: '2026-09-21',
      description: 'BCA Pocket Valas: USD → SGD',
      lines: exchangeLines({ fromAccountId: pockets[0]!.id, fromAmountMinor: 50_000, fromCurrency: 'USD', toAccountId: pockets[1]!.id, toAmountMinor: 63_800, toCurrency: 'SGD', exchangeAccountId: exchangeId }),
      ratesToBase: { USD: 16_250, SGD: 12_680 },
    });
    return { pockets, exchangeId, id };
  };

  it('records the bank’s spread on the Currency exchange account, to the rupiah the screen showed', async () => {
    const { exchangeId, id } = await moveUsdToSgd();
    const legs = await database.db
      .select({ base: schema.entries.amountBaseMinor })
      .from(schema.entries)
      .where(and(eq(schema.entries.transactionId, id), eq(schema.entries.accountId, exchangeId)));
    const recorded = legs.reduce((sum, leg) => sum + leg.base, 0);
    const shown = exchangeCost({ fromMinor: 50_000, fromCurrency: 'USD', toMinor: 63_800, toCurrency: 'SGD', baseCurrency: 'IDR', ratesToBase: { USD: 16_250, SGD: 12_680 } })!;
    expect(recorded).toBe(shown.costMinor);
    expect(recorded).toBe(35_160);
  });

  it('moves the pockets’ own balances, each in its own currency', async () => {
    const { pockets } = await moveUsdToSgd();
    const balances = await nativeBalances(database, ws);
    expect([balances[pockets[0]!.id], balances[pockets[1]!.id]]).toEqual([190_000, 178_800]);
  });

  it('reaches neither income nor spending, and lowers put-away by exactly the spread (today’s rule, pinned)', async () => {
    await moveUsdToSgd();
    const flows = await periodFlows(database, ws, { from: '2026-09-01', to: '2026-09-30' });
    expect([flows.incomeMinor, flows.spendingMinor, flows.putAwayMinor]).toEqual([0, 0, -35_160]);
  });
});
