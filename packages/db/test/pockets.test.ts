import { exchangeCost, exchangeLines, openingBalanceLines, transferLines } from '@expanses/core';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addPocket,
  archiveAccount,
  assetValuesAt,
  coretaxInputsFor,
  createAccount,
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
  recordValuation,
  renameAccount,
  saveAssetProfile,
  schema,
  systemAccountId,
  voidTransaction,
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

describe('openingsOf: filters and order (M-3, b12/b13)', () => {
  it('finds the earliest posted opening for an account, ignoring a voided one and a later one', async () => {
    const { parent, pockets } = await valas();
    const equityId = await systemAccountId(database.db, ws, 'opening_balance');
    const jpy = await addPocket(database, ws, { parentId: parent.id, currency: 'JPY' });
    // A typo'd opening, voided — b12: must not be read even though it is chronologically earliest of all three.
    const voidedId = await postTransaction(database, ws, {
      occurredOn: '2025-05-01',
      description: 'Opening balance: JPY (typo)',
      lines: openingBalanceLines({ accountId: jpy.id, kind: 'asset', balanceMinor: 10_000, currency: 'JPY', equityAccountId: equityId }),
      ratesToBase: { JPY: 999 },
    });
    await voidTransaction(database, ws, voidedId);
    // The earliest of the two posted openings — b13: must not be the later one.
    await postTransaction(database, ws, {
      occurredOn: '2025-06-01',
      description: 'Opening balance: JPY',
      lines: openingBalanceLines({ accountId: jpy.id, kind: 'asset', balanceMinor: 30_000, currency: 'JPY', equityAccountId: equityId }),
      ratesToBase: { JPY: 108.3 },
    });
    await postTransaction(database, ws, {
      occurredOn: '2025-07-01',
      description: 'Opening balance: JPY (again)',
      lines: openingBalanceLines({ accountId: jpy.id, kind: 'asset', balanceMinor: 30_000, currency: 'JPY', equityAccountId: equityId }),
      ratesToBase: { JPY: 200 },
    });
    const openings = await openingsOf(database, ws, [jpy.id, pockets[0]!.id]);
    expect(openings[jpy.id]).toEqual({ occurredOn: '2025-06-01', amountMinor: 30_000, currency: 'JPY', fxRateToBase: 108.3 });
    // Untouched account still reads its own single opening correctly.
    expect(openings[pockets[0]!.id]!.fxRateToBase).toBe(15_940);
  });
});

describe('archived pockets: the one-per-currency rule, the archive guard, and every reader (I-3, M-4: c7/c10)', () => {
  /** Two pockets, both opened with nothing in them, so either can be archived without a transfer first. */
  const emptyPockets = () =>
    openPocketedAccount(database, ws, { item: 'savings', name: 'Empty Multi', openedOn: '2026-01-01', pockets: [{ currency: 'USD' }, { currency: 'SGD' }] });

  it('c7 — archiving a pocket frees its currency for addPocket to reuse', async () => {
    const { parent, pockets } = await emptyPockets();
    await archiveAccount(database, ws, pockets[0]!.id); // USD
    const usd2 = await addPocket(database, ws, { parentId: parent.id, currency: 'USD' });
    expect(usd2.currency).toBe('USD');
  });

  it('c10 — a parent can be archived once every one of its pockets is archived, not before', async () => {
    const { parent, pockets } = await emptyPockets();
    await archiveAccount(database, ws, pockets[0]!.id);
    await expect(archiveAccount(database, ws, parent.id)).rejects.toThrow('still has pockets: SGD');
    await archiveAccount(database, ws, pockets[1]!.id);
    await archiveAccount(database, ws, parent.id); // now succeeds
    expect((await listAccounts(database, ws)).some((a) => a.id === parent.id)).toBe(false);
  });

  it('e3/d2 — with all pockets archived but the parent left open, the parent stays invisible and still refuses postings', async () => {
    const { parent, pockets } = await emptyPockets();
    await archiveAccount(database, ws, pockets[0]!.id);
    await archiveAccount(database, ws, pockets[1]!.id);
    // e3: pocketParentIds (and so assetValuesAt) still recognises it as a parent from the archived rows —
    // an empty parent must not reappear as a 0-valued row in net worth, idle cash or goal funding.
    const values = await assetValuesAt(database, ws, '2026-09-21');
    expect(values.some((row) => row.accountId === parent.id)).toBe(false);
    // d2: the ledger's refusal is not limited to a parent with open pockets. The parent's own currency is always
    // the workspace base (IDR), so the other leg is an ordinary IDR account — not one of the (now archived) pockets,
    // which would confound the refusal with a currency mismatch.
    const sink = await createAccount(database, ws, { name: 'Sink', kind: 'asset', subtype: 'cash', currency: 'IDR' });
    await expect(
      postTransaction(database, ws, {
        occurredOn: '2026-09-21',
        description: 'Into the emptied parent',
        lines: transferLines({ fromAccountId: sink.id, toAccountId: parent.id, amountMinor: 1_000, currency: 'IDR' }),
      }),
    ).rejects.toMatchObject({ code: 'POCKET_PARENT' });
  });

  it('e2 — an archived non-pocket asset with a manual valuation leaves assetValuesAt and netWorthAt entirely', async () => {
    const house = await createAccount(database, ws, { name: 'Empty Land', kind: 'asset', subtype: 'property', currency: 'IDR' });
    await saveAssetProfile(database, ws, { accountId: house.id, assetKind: 'property' });
    await recordValuation(database, ws, { accountId: house.id, asOf: '2026-01-01', valueMinor: 500_000_000, basis: 'appraisal' });
    expect((await assetValuesAt(database, ws, '2026-09-21')).some((row) => row.accountId === house.id)).toBe(true);
    expect((await netWorthAt(database, ws, '2026-09-21', {})).assetsMinor).toBe(500_000_000);

    await archiveAccount(database, ws, house.id);
    expect((await assetValuesAt(database, ws, '2026-09-21')).some((row) => row.accountId === house.id)).toBe(false);
    expect((await netWorthAt(database, ws, '2026-09-21', {})).assetsMinor).toBe(0);
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
