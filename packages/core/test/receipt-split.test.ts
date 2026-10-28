import { describe, expect, it } from 'vitest';
import { allocateByWeights, splitReceipt } from '../src/debts/receipt-split';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('allocateByWeights', () => {
  it('gives the units left to the largest remainders, the earlier person on a tie', () => {
    expect(allocateByWeights(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(allocateByWeights(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocateByWeights(100, [1, 2])).toEqual([33, 67]);
    expect(allocateByWeights(5, [0, 3, 3])).toEqual([0, 3, 2]);
  });

  it('divides equally when nobody has any weight, and takes a discount as its opposite', () => {
    expect(allocateByWeights(7, [0, 0])).toEqual([4, 3]);
    expect(allocateByWeights(-10, [1, 1, 1])).toEqual([-4, -3, -3]);
    expect(allocateByWeights(0, [1, 2])).toEqual([0, 0]);
    expect(allocateByWeights(5, [])).toEqual([]);
  });

  it('always adds up exactly, with large figures', () => {
    for (const total of [1, 7, 999, 196_350, 1_000_000_007, 9_000_000_000_000]) {
      for (const weights of [[1, 1, 1], [3, 5, 11], [1, 0, 0, 7], [123_456_789, 987_654_321]]) {
        expect(sum(allocateByWeights(total, weights))).toBe(total);
        expect(sum(allocateByWeights(-total, weights))).toBe(-total);
      }
    }
  });
});

describe('splitReceipt', () => {
  // Me, Dewi, Sari: the mock's invented bill.
  const items = [
    { amountMinor: 45_000, sharedBy: [1] },
    { amountMinor: 38_000, sharedBy: [0] },
    { amountMinor: 60_000, sharedBy: [0, 1, 2] },
    { amountMinor: 27_000, sharedBy: [0, 1, 2] },
  ];

  it('shares charges in proportion to each person’s food', () => {
    const r = splitReceipt(3, items, [{ amountMinor: 8_500, mode: 'pro-rata' }, { amountMinor: 17_850, mode: 'pro-rata' }]);
    expect(r.itemsMinor).toEqual([38_000 + 20_000 + 9_000, 45_000 + 20_000 + 9_000, 20_000 + 9_000]);
    expect(sum(r.totals)).toBe(196_350);
    expect(r.itemCount).toEqual([3, 3, 2]);
    // Sari had the least food and pays the least of the charges.
    expect(r.totals[2]! - r.itemsMinor[2]!).toBeLessThan(r.totals[0]! - r.itemsMinor[0]!);
  });

  it('shares an equal charge equally, and a person with no food pays none of a pro-rata one', () => {
    const r = splitReceipt(3, [{ amountMinor: 30_000, sharedBy: [0, 1] }], [{ amountMinor: 9_000, mode: 'pro-rata' }]);
    expect(r.totals).toEqual([19_500, 19_500, 0]);
    const e = splitReceipt(3, [{ amountMinor: 30_000, sharedBy: [0, 1] }], [{ amountMinor: 9_000, mode: 'equal' }]);
    expect(e.totals).toEqual([18_000, 18_000, 3_000]);
  });

  it('treats a dish nobody was tagged on as shared by everyone', () => {
    const r = splitReceipt(3, [{ amountMinor: 10_000, sharedBy: [] }], []);
    expect(r.totals).toEqual([3_334, 3_333, 3_333]);
    expect(r.itemCount).toEqual([1, 1, 1]);
  });

  it('ignores a person who is not on the bill and counts a repeated tag once', () => {
    const r = splitReceipt(2, [{ amountMinor: 9_000, sharedBy: [0, 0, 5] }], []);
    expect(r.totals).toEqual([9_000, 0]);
  });

  it('adds up exactly for currencies with 0, 2 and 3 decimals', () => {
    for (const unit of [1, 100, 1000]) {
      const dishes = [1999, 2501, 777, 3333].map((n, k) => ({ amountMinor: n * unit, sharedBy: k === 0 ? [] : k === 1 ? [0, 2] : [k % 3, (k + 1) % 3] }));
      const charges = [{ amountMinor: 1234 * unit + 1, mode: 'pro-rata' as const }, { amountMinor: -500 * unit - 3, mode: 'equal' as const }, { amountMinor: 7, mode: 'pro-rata' as const }];
      const r = splitReceipt(3, dishes, charges);
      const bill = sum(dishes.map((d) => d.amountMinor)) + sum(charges.map((c) => c.amountMinor));
      expect(sum(r.totals)).toBe(bill);
    }
  });
});
