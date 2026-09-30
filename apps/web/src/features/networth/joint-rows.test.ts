import { balanceSheet, type ItemSummary } from '@expanses/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { figureOf, jointRows, jointSeries, jointStatus, ownerRing, type ReceivedItem } from './joint-rows';
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
  it('assigns ring colours by the order of the group’s members, the same on every phone', () => {
    expect(ownerRing([RINA, ANDI], RINA)).toBe('var(--owner-1)');
    expect(ownerRing([RINA, ANDI], ANDI)).toBe('var(--owner-2)');
    expect(ownerRing([ANDI, RINA, 'm-3'], 'm-3')).toBe('var(--owner-3)');
    expect(ownerRing([RINA, ANDI], 'someone-else')).toBeNull();
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
