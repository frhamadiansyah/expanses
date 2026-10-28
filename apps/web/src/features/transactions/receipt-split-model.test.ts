import { readReceiptLines } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { billOf, effectiveCharges, memoFromReading, mismatchOf, sharesOf, toggleSharer, usable, withReceiptApplied } from './receipt-split-model';
import { emptyForm, withShares } from './tx-form';

const line = (text: string, i: number) => ({ text, box: [0.1, 0.05 + i * 0.05, 0.8, 0.03] as [number, number, number, number], height: 0.03 });
const READ = readReceiptLines(
  ['WARUNG LAUT', 'Nasi goreng 45.000', 'Mie ayam 38.000', 'Sate (10) 60.000', 'Es teh x3 27.000', 'Service 5% 8.500', 'PPN 10% 17.850', 'TOTAL 196.350'].map(line),
  'IDR',
);
const people = [
  { debtAccountId: '', name: 'Dewi', amount: '' },
  { debtAccountId: '', name: 'Sari', amount: '' },
];

describe('the receipt split model', () => {
  it('shares dishes and charges and every share adds to the bill', () => {
    let memo = memoFromReading(READ, 'IDR', people);
    memo = { ...memo, items: memo.items.map((item, i) => (i === 0 ? { ...item, sharedBy: [1] } : i === 1 ? { ...item, sharedBy: [0] } : item)) };
    expect(mismatchOf(memo)).toBe(0);
    expect(billOf(memo)).toBe(196_350);
    const shares = sharesOf(memo);
    expect(shares.totals.reduce((a, b) => a + b, 0)).toBe(196_350);
    expect(shares.itemCount).toEqual([3, 3, 2]);
  });

  it('needs the difference explained before it can be used, and "Other" explains it', () => {
    const memo = memoFromReading({ ...READ, total: 200_000 }, 'IDR', people);
    expect(mismatchOf(memo)).toBe(3_650);
    expect(usable(memo)).toBe(false);
    const accepted = { ...memo, useTotal: true };
    expect(effectiveCharges(accepted).at(-1)).toMatchObject({ label: 'Other', amountMinor: 3_650 });
    expect(billOf(accepted)).toBe(200_000);
    expect(usable(accepted)).toBe(true);
    expect(sharesOf(accepted).totals.reduce((a, b) => a + b, 0)).toBe(200_000);
  });

  it('toggles a sharer in order', () => {
    const item = { id: 'a', name: 'x', quantity: 1, amountMinor: 1, sharedBy: [] as number[] };
    expect(toggleSharer(toggleSharer(item, 2), 0).sharedBy).toEqual([0, 2]);
    expect(toggleSharer(toggleSharer(item, 2), 2).sharedBy).toEqual([]);
  });

  it('puts custom amounts on the With rows that the form’s own split reads back to the rupiah', () => {
    const memo = memoFromReading(READ, 'IDR', people);
    const draft = { ...emptyForm('b', '2026-10-29'), with: people, withEqually: true };
    const next = withReceiptApplied(draft, memo, '2026-10-29');
    expect(next.withEqually).toBe(false);
    expect(next.amount).toBe('196350');
    expect(next.description).toBe('WARUNG LAUT');
    expect(next.receiptSplit).toBe(memo);
    const { each, ownShareMinor } = withShares(next, 'IDR', 196_350, { lenient: false });
    const shares = sharesOf(memo);
    expect(each).toEqual([shares.totals[1], shares.totals[2]]);
    expect(ownShareMinor).toBe(shares.totals[0]);
  });

  it('leaves off a person with no share, keeps the typed note and keeps the form’s day unless the receipt is older', () => {
    const memo = memoFromReading(READ, 'IDR', people);
    memo.items = memo.items.map((item) => ({ ...item, sharedBy: [0, 1] }));
    const draft = { ...emptyForm('b', '2026-10-29'), description: 'Dinner', with: people };
    const next = withReceiptApplied(draft, memo, '2026-10-29');
    expect(next.with.map((row) => row.name)).toEqual(['Dewi']);
    expect(next.description).toBe('Dinner');
    const dated = withReceiptApplied(draft, { ...memo, date: '2026-10-12' }, '2026-10-29');
    expect(dated.occurredOn).toBe('2026-10-12');
    const typedDay = withReceiptApplied({ ...draft, occurredOn: '2026-10-20' }, { ...memo, date: '2026-10-12' }, '2026-10-29');
    expect(typedDay.occurredOn).toBe('2026-10-20');
  });

  it('uses two decimals for a currency that has them', () => {
    const usd = readReceiptLines(['Burger 12,50', 'Tax 1,34', 'Total 13,84'].map(line), 'USD');
    const memo = memoFromReading(usd, 'USD', people.slice(0, 1));
    const next = withReceiptApplied({ ...emptyForm('b', '2026-10-29'), with: people.slice(0, 1) }, memo, '2026-10-29');
    expect(next.amount).toBe('13.84');
    expect(Number(next.with[0]!.amount)).toBeCloseTo(6.92, 2);
  });
});
