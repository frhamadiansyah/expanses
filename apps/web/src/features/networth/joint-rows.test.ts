import { balanceSheet, type ItemSummary, resolveRings } from '@expanses/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { figureOf, groupItems, jointRows, jointSeries, jointStatus, ownerRing, type ReceivedItem, receivedPocketAccounts, sheetOwnerOf } from './joint-rows';
import { foldPockets } from './overview-rows';
import { rowKindOf, sheetDrawers } from './sheet-drawers';

const RINA = 'm-rina';
const ANDI = 'm-andi';

function item(over: Partial<ItemSummary> & { itemId: string }): ReceivedItem {
  return {
    owner: ANDI,
    kind: 'asset',
    subtype: 'bank',
    name: 'Andi BCA',
    currency: 'IDR',
    balanceMinor: 0,
    asOf: '2026-09-30',
    card: null,
    period: { start: '2026-09-01', end: '2026-09-30' },
    openingMinor: 0,
    householdMinor: 0,
    otherUseMinor: 0,
    transferMinor: 0,
    transfers: [],
    monthEnds: [],
    tax: null,
    ...over,
  };
}

const own = {
  assets: [
    { accountId: 'a-bca', name: 'Rina BCA', planGroup: 'liquid' as const, valueMinor: 50_000_000, code: null, subtype: 'bank' },
    { accountId: 'a-house', name: 'Flat', planGroup: 'use' as const, valueMinor: 10_000_000, code: null, subtype: 'property' },
  ],
  liabilities: [{ accountId: 'l-card', name: 'Rina Visa', subtype: 'credit_card' as const, balanceMinor: 1_200_000, dueWithinYearMinor: 1_200_000, note: null, icon: 'card' as const }],
  missing: [] as string[],
};

describe('jointRows (spec §8.2, D12)', () => {
  it('merges two owners into the same kind drawers, with subtotals and a subtotal per owner', () => {
    const received = [
      item({ itemId: 'i-mandiri', name: 'Andi Mandiri', balanceMinor: 400_000_000 }),
      item({ itemId: 'i-loan', kind: 'liability', subtype: 'loan', name: 'Car loan', balanceMinor: 20_000_000 }),
    ];
    const joint = jointRows(own, received, RINA, {}, 'IDR');

    expect(joint.totalMinor).toBe(50_000_000 + 10_000_000 - 1_200_000 + 400_000_000 - 20_000_000);
    expect(joint.byOwner).toEqual({ [RINA]: 58_800_000, [ANDI]: 380_000_000 });
    expect(joint.missing).toEqual([]);

    // Every row says whose it is; the received one is known by its itemId, never an account id.
    expect(joint.rows.map((row) => [row.accountId, row.owner])).toEqual([
      ['a-bca', RINA],
      ['a-house', RINA],
      ['l-card', RINA],
      ['i-mandiri', ANDI],
      ['i-loan', ANDI],
    ]);

    // Folded as today: both banks in one "bank" drawer of Cash & equivalents, whose subtotal holds both.
    const sheet = balanceSheet(joint.assets, joint.liabilities);
    expect(sheet.netWorthMinor).toBe(joint.totalMinor);
    const cash = sheet.assetGroups.find((group) => group.key === 'liquid')!;
    const subtypes = new Map([...joint.rows].map((row) => [row.accountId, row.subtype as never]));
    const drawers = sheetDrawers(cash.rows, (row) => rowKindOf('liquid', row, (id) => subtypes.get(id)));
    expect(drawers).toHaveLength(1);
    expect(drawers[0]!.key).toBe('bank');
    expect(drawers[0]!.totalMinor).toBe(450_000_000);
    expect(drawers[0]!.rows.map((row) => row.accountId)).toEqual(['a-bca', 'i-mandiri']);
    // A received loan folds with the loans by what it is.
    expect(joint.liabilities.find((row) => row.accountId === 'i-loan')?.icon).toBe('loan');
  });

  it('converts a received item with the viewer’s own rates, as own rows are', () => {
    const joint = jointRows(own, [item({ itemId: 'i-usd', currency: 'USD', balanceMinor: 10_000 })], RINA, { USD: 16_000 }, 'IDR');
    // 100.00 USD at 16 000 = 1 600 000 IDR (IDR has no minor unit).
    expect(joint.byOwner[ANDI]).toBe(1_600_000);
    expect(joint.rows.find((row) => row.accountId === 'i-usd')).toMatchObject({ currency: 'USD', nativeMinor: 10_000, amountMinor: 1_600_000 });
  });

  it('a missing rate blanks the total and that owner’s subtotal, and the row stays with its native balance', () => {
    const received = [item({ itemId: 'i-usd', currency: 'USD', name: 'Andi Chase', balanceMinor: 10_000 }), item({ itemId: 'i-idr', balanceMinor: 5_000_000 })];
    const joint = jointRows(own, received, RINA, {}, 'IDR');
    expect(joint.totalMinor).toBeNull();
    expect(joint.byOwner[ANDI]).toBeNull();
    expect(joint.byOwner[RINA]).toBe(58_800_000);
    expect(joint.missing).toEqual(['USD']);
    expect(joint.rows.find((row) => row.accountId === 'i-usd')).toMatchObject({ currency: 'USD', nativeMinor: 10_000, amountMinor: null, name: 'Andi Chase' });
  });

  it('a rate missing on the viewer’s own rows blanks the viewer’s subtotal and the total', () => {
    const joint = jointRows({ ...own, missing: ['SGD'] }, [item({ itemId: 'i-idr', balanceMinor: 5_000_000 })], RINA, {}, 'IDR');
    expect(joint.totalMinor).toBeNull();
    expect(joint.byOwner[RINA]).toBeNull();
    expect(joint.byOwner[ANDI]).toBe(5_000_000);
    expect(joint.missing).toEqual(['SGD']);
  });

  it('a received debt of nothing owed is left out, as an own one is', () => {
    const joint = jointRows(own, [item({ itemId: 'i-card', kind: 'liability', subtype: 'credit_card', balanceMinor: -50_000 })], RINA, {}, 'IDR');
    expect(joint.liabilities.some((row) => row.accountId === 'i-card')).toBe(false);
    expect(joint.byOwner[ANDI]).toBe(0);
  });

  it('on an earlier date a received item reads its month-end value (health ratios for a past year)', () => {
    const received = [item({ itemId: 'i-idr', balanceMinor: 9_000_000, monthEnds: [{ month: '2025-12', balanceMinor: 7_000_000 }] })];
    expect(jointRows(own, received, RINA, {}, 'IDR', { date: '2025-12-31' }).byOwner[ANDI]).toBe(7_000_000);
    expect(jointRows(own, received, RINA, {}, 'IDR', { date: '2026-09-30' }).byOwner[ANDI]).toBe(9_000_000);
  });

  it('property: the total is the sum of the owners’ subtotals and of the balance sheet it feeds', () => {
    const summary = fc.record({
      kind: fc.constantFrom<'asset' | 'liability'>('asset', 'liability'),
      balanceMinor: fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }),
      owner: fc.constantFrom(ANDI, 'm-third'),
    });
    fc.assert(
      fc.property(fc.array(summary, { maxLength: 12 }), (rows) => {
        const received = rows.map((row, i) =>
          item({ itemId: `i-${i}`, owner: row.owner, kind: row.kind, subtype: row.kind === 'asset' ? 'bank' : 'loan', balanceMinor: row.balanceMinor }),
        );
        const joint = jointRows(own, received, RINA, {}, 'IDR');
        const sum = Object.values(joint.byOwner).reduce<number>((acc, value) => acc + (value ?? 0), 0);
        expect(joint.totalMinor).toBe(sum);
        expect(balanceSheet(joint.assets, joint.liabilities).netWorthMinor).toBe(joint.totalMinor);
      }),
    );
  });
});

describe('jointRows: a received item is filed by the facts its owner sent (sheet)', () => {
  it('a gold holding goes to "Intangible and other" and a paylater keeps its kind, as on the owner’s phone', () => {
    const received = [
      item({ itemId: 'i-gold', name: 'Andi gold', subtype: 'investment', balanceMinor: 7_000_000, sheet: { code: '0701' } }),
      item({ itemId: 'i-pay', name: 'Andi paylater', kind: 'liability', subtype: 'loan', balanceMinor: 1_000_000, sheet: { item: 'online_loan', icon: 'loan' } }),
    ];
    const rows = jointRows({ assets: [], liabilities: [], missing: [] }, received, RINA, {}, 'IDR', { members: [RINA, ANDI] });
    expect(balanceSheet(rows.assets, rows.liabilities).assetGroups.map((group) => group.key)).toEqual(['other']);
    expect(rows.liabilities[0]).toMatchObject({ item: 'online_loan', icon: 'loan' });
  });
});

describe('jointRows, review round 1', () => {
  it('a member with nothing shared yet reads 0 in the legend, not a dash (finding 4)', () => {
    expect(jointRows(own, [], RINA, {}, 'IDR', { members: [RINA, ANDI] }).byOwner).toEqual({ [RINA]: 58_800_000, [ANDI]: 0 });
  });

  it('a received debt is never due within a year: its summary carries no schedule (finding 5)', () => {
    const joint = jointRows(own, [item({ itemId: 'i-loan', kind: 'liability', subtype: 'loan', balanceMinor: 20_000_000 })], RINA, {}, 'IDR');
    const sheet = balanceSheet(joint.assets, joint.liabilities);
    expect(sheet.shortTerm.rows.some((row) => row.accountId === 'i-loan')).toBe(false);
    expect(sheet.longTerm.rows.find((row) => row.accountId === 'i-loan')?.amountMinor).toBe(20_000_000);
    expect(sheet.netWorthMinor).toBe(joint.totalMinor);
  });

  it('a date older than the month-ends an item sent is unknown, not 0 (finding 6)', () => {
    const received = [item({ itemId: 'i-idr', name: 'Andi BCA', balanceMinor: 9_000_000, monthEnds: [{ month: '2025-12', balanceMinor: 7_000_000 }] })];
    const joint = jointRows(own, received, RINA, {}, 'IDR', { date: '2023-12-31' });
    expect(joint.byOwner[ANDI]).toBeNull();
    expect(joint.totalMinor).toBeNull();
    expect(joint.missing).toEqual([]);
    expect(joint.noHistory).toEqual(['Andi BCA']);
    expect(joint.rows.find((row) => row.accountId === 'i-idr')?.amountMinor).toBeNull();
  });

  it('a figure over rows any of which has no rate is blank, never a sum that counts it as 0 (finding 2)', () => {
    expect(figureOf(500, ['a', 'b'], new Set())).toBe(500);
    expect(figureOf(500, ['a', 'b'], new Set(['b']))).toBeNull();
    expect(figureOf(500, ['a'], new Set(['b']))).toBe(500);
  });
});

describe('jointStatus (finding 1: the personal total is never shown as the household\'s)', () => {
  const settled = { pending: false, error: null };
  it('is personal only once the group is known not to file jointly', () => {
    expect(jointStatus({ group: { pending: false, error: null, mode: null }, inputs: settled })).toBe('personal');
    expect(jointStatus({ group: { pending: false, error: null, mode: 'separate' }, inputs: settled })).toBe('personal');
  });
  it('holds while the group or the joint inputs are loading, and says so on an error', () => {
    expect(jointStatus({ group: { pending: true, error: null, mode: null }, inputs: settled })).toBe('pending');
    expect(jointStatus({ group: { pending: false, error: new Error('x'), mode: null }, inputs: settled })).toBe('error');
    expect(jointStatus({ group: { pending: false, error: null, mode: 'joint' }, inputs: { pending: true, error: null } })).toBe('pending');
    expect(jointStatus({ group: { pending: false, error: null, mode: 'joint' }, inputs: { pending: true, error: new Error('rates') } })).toBe('error');
    expect(jointStatus({ group: { pending: false, error: null, mode: 'joint' }, inputs: settled })).toBe('joint');
  });
});

describe('ownerRing', () => {
  it('draws each member in the colour the group resolved for them, the same on every phone', () => {
    // By place in the group, as before, when nobody picked.
    const byPlace = resolveRings([RINA, ANDI], {});
    expect(ownerRing(byPlace, RINA)).toBe('var(--owner-blue)');
    expect(ownerRing(byPlace, ANDI)).toBe('var(--owner-purple)');
    // A member's own pick.
    expect(ownerRing(resolveRings([RINA, ANDI], { [RINA]: { colour: 'teal', at: '2026-11-12T01:00:00.000Z' } }), RINA)).toBe('var(--owner-teal)');
    expect(ownerRing(byPlace, 'someone-else')).toBeNull();
  });
});

describe('jointSeries (the household line under a household total)', () => {
  const point = (month: string, netWorthMinor: number) => ({
    month,
    onDate: `${month}-28`,
    assetsMinor: netWorthMinor,
    liabilitiesMinor: 0,
    netWorthMinor,
    missing: [] as string[],
    stack: { assets: { liquid: netWorthMinor, receivable: 0, invest: 0, movable: 0, immovable: 0, other: 0 }, liabilities: { credit_card: 0, loan: 0, payable: 0 } },
  });

  it('adds each received item at its month-end, and today’s balance for its own month, into the figure and the stacks', () => {
    const received = [
      item({ itemId: 'i-bank', balanceMinor: 9_000, asOf: '2026-09-30', monthEnds: [{ month: '2026-08', balanceMinor: 7_000 }] }),
      item({ itemId: 'i-loan', kind: 'liability', subtype: 'loan', balanceMinor: 2_000, asOf: '2026-09-30', monthEnds: [{ month: '2026-08', balanceMinor: 3_000 }] }),
    ];
    const series = jointSeries([point('2026-08', 100), point('2026-09', 200)], received, {}, 'IDR');
    expect(series.map((p) => p.netWorthMinor)).toEqual([100 + 7_000 - 3_000, 200 + 9_000 - 2_000]);
    expect(series[1]!.stack!.assets.liquid).toBe(200 + 9_000);
    expect(series[1]!.stack!.liabilities.loan).toBe(2_000);
  });

  it('a month older than the month-ends an item sent has no figure (finding 6)', () => {
    const series = jointSeries([point('2023-01', 100)], [item({ itemId: 'i-bank', balanceMinor: 9_000, monthEnds: [{ month: '2026-08', balanceMinor: 7_000 }] })], {}, 'IDR');
    expect(series[0]).toMatchObject({ netWorthMinor: null, stack: null });
  });

  it('a month a received item has no rate for has no figure and names the currency', () => {
    const series = jointSeries([point('2026-09', 200)], [item({ itemId: 'i-usd', currency: 'USD', balanceMinor: 100 })], {}, 'IDR');
    expect(series[0]).toMatchObject({ netWorthMinor: null, stack: null, missing: ['USD'] });
  });
});

describe('groupItems (final review item 8)', () => {
  it("keeps only the active group's members' items: a former member's rows still in the log are not the household's", () => {
    const items = [item({ itemId: 'a', owner: ANDI }), item({ itemId: 's', owner: 'm-sari' }), item({ itemId: 'a2', owner: ANDI })];
    expect(groupItems(items, [RINA, ANDI]).map((i) => i.itemId)).toEqual(['a', 'a2']);
    expect(groupItems(items, [RINA])).toEqual([]);
  });
});

describe('sheetOwnerOf: every row of the household sheet has an owner to ring', () => {
  // Cash with a TRY pocket, a bank account with USD and SGD pockets, and gold in grams, as the sheet is fed: leaves only.
  const sheetOwn = {
    assets: [
      { accountId: 'cash-idr', name: 'Cash · IDR', planGroup: 'liquid' as const, valueMinor: 800_000, code: null, subtype: 'cash' },
      { accountId: 'cash-try', name: 'Cash · TRY', planGroup: 'liquid' as const, valueMinor: 400_000, code: null, subtype: 'cash' },
      { accountId: 'valas-usd', name: 'Valas · USD', planGroup: 'liquid' as const, valueMinor: 16_000_000, code: null, subtype: 'savings' },
      { accountId: 'valas-sgd', name: 'Valas · SGD', planGroup: 'liquid' as const, valueMinor: 12_000_000, code: null, subtype: 'savings' },
      { accountId: 'gold', name: 'Antam bars', planGroup: 'invest' as const, valueMinor: 18_600_000, code: null, subtype: 'investment' },
    ],
    liabilities: [],
    missing: [] as string[],
  };
  const accounts = [
    { id: 'cash', name: 'Cash', kind: 'asset', parentId: null, currency: 'IDR' },
    { id: 'cash-idr', name: 'Cash · IDR', kind: 'asset', parentId: 'cash', currency: 'IDR' },
    { id: 'cash-try', name: 'Cash · TRY', kind: 'asset', parentId: 'cash', currency: 'TRY' },
    { id: 'valas', name: 'Valas', kind: 'asset', parentId: null, currency: 'IDR' },
    { id: 'valas-usd', name: 'Valas · USD', kind: 'asset', parentId: 'valas', currency: 'USD' },
    { id: 'valas-sgd', name: 'Valas · SGD', kind: 'asset', parentId: 'valas', currency: 'SGD' },
    { id: 'gold', name: 'Antam bars', kind: 'asset', parentId: null, currency: 'IDR' },
  ] as const;
  const joint = jointRows(sheetOwn, [item({ itemId: 'i-andi', name: 'Andi Mandiri', balanceMinor: 1_000_000 })], RINA, {}, 'IDR');
  const owners = new Map(joint.rows.map((row) => [row.accountId, row]));
  const shown = foldPockets(balanceSheet(joint.assets, joint.liabilities).assetGroups, accounts as never, 'IDR').flatMap((group) => group.rows);

  it('reproduces the miss: the folded parents are on the sheet but are no joint row', () => {
    expect(shown.map((row) => row.accountId).sort()).toEqual(['cash', 'gold', 'i-andi', 'valas']);
    expect(owners.get('cash')).toBeUndefined();
    expect(owners.get('valas')).toBeUndefined();
    expect(owners.get('gold')).toBeDefined();
  });

  it('gives a parent its pockets’ owner, and every row on the sheet an owner', () => {
    for (const row of shown) expect(sheetOwnerOf(row.accountId, owners, accounts, RINA)).toMatchObject({ owner: row.accountId === 'i-andi' ? ANDI : RINA });
    expect(sheetOwnerOf('cash', owners, accounts, RINA)).toMatchObject({ owner: RINA, received: false });
    expect(sheetOwnerOf('valas', owners, accounts, RINA)).toMatchObject({ owner: RINA, received: false });
  });

  it('leaves the partner’s received rows as they were, found by id', () => {
    const found = sheetOwnerOf('i-andi', owners, accounts, RINA);
    expect(found).toMatchObject({ owner: ANDI, received: true });
    expect(found.row).toBe(owners.get('i-andi'));
  });

  it('takes a row no joint row speaks for as this phone’s own', () => {
    expect(sheetOwnerOf('not-on-the-sheet', owners, accounts, RINA)).toEqual({ owner: RINA, received: false, row: null });
  });

  it('rings a parent in its pockets’ owner’s colour, whoever this phone is', () => {
    const rings = resolveRings([RINA, ANDI], {});
    const { owner } = sheetOwnerOf('cash', owners, accounts, RINA);
    expect(ownerRing(rings, owner)).toBe(ownerRing(rings, RINA));
    expect(ownerRing(rings, owner)).not.toBeNull();
  });
});

describe('the partner’s account with pockets on the household sheet (owner, 13 Nov: one row on both phones)', () => {
  const pocketOf = { id: 'i-travel', name: 'Travel wallet' };
  const pockets = [
    item({ itemId: 'i-travel-idr', name: 'Travel wallet · IDR', balanceMinor: 3_100_000, pocketOf }),
    item({ itemId: 'i-travel-usd', name: 'Travel wallet · USD', currency: 'USD', balanceMinor: 120_00, pocketOf }),
    item({ itemId: 'i-mandiri', name: 'Andi Mandiri', balanceMinor: 7_000_000 }),
  ];
  const rates = { USD: 15_900 };

  it('folds the pockets into one row, the account’s, at their total and marked ≈; the totals are unchanged', () => {
    const joint = jointRows(own, pockets, RINA, rates, 'IDR');
    const sheet = balanceSheet(joint.assets, joint.liabilities);
    const { pockets: folds, parents } = receivedPocketAccounts(pockets, joint.rows, 'IDR');
    const rows = foldPockets(sheet.assetGroups, [], 'IDR', folds).flatMap((group) => group.rows);
    const usd = 120_00 * 159;
    expect(rows.filter((row) => row.name.startsWith('Travel wallet'))).toEqual([{ accountId: 'i-travel', name: 'Travel wallet', amountMinor: 3_100_000 + usd, note: null, approx: true }]);
    expect(rows.some((row) => row.accountId === 'i-mandiri')).toBe(true);
    expect(sheet.assetsTotalMinor).toBe(50_000_000 + 10_000_000 + 3_100_000 + usd + 7_000_000);
    // The row is the partner’s: it wears their ring and opens their account’s page.
    expect(parents.get('i-travel')).toMatchObject({ owner: ANDI, received: true, amountMinor: 3_100_000 + usd, subtype: 'bank' });
  });

  it('with no rate for a pocket, the pockets stay rows of their own, each in its own currency', () => {
    const joint = jointRows(own, pockets, RINA, {}, 'IDR');
    const { pockets: folds, parents } = receivedPocketAccounts(pockets, joint.rows, 'IDR');
    expect(folds.size).toBe(0);
    expect(parents.size).toBe(0);
  });

  it('a pocket from a peer before this release names no account and is folded into nothing', () => {
    const old = pockets.map(({ pocketOf: _pocketOf, ...rest }) => rest);
    const joint = jointRows(own, old, RINA, rates, 'IDR');
    expect(receivedPocketAccounts(old, joint.rows, 'IDR').pockets.size).toBe(0);
  });
});
