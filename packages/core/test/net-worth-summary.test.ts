import { describe, expect, it } from 'vitest';
import { cardBar, lastMonthEnds, splitPeriod, summaryHash, type ItemSummary } from '../src/net-worth/summary';

describe('splitPeriod', () => {
  it('adds household and other use to the opening', () => {
    const r = splitPeriod(0, [
      { transactionId: 't1', amountMinor: 50_000_000, household: true },
      { transactionId: 't2', amountMinor: 100_000_000, household: false },
    ]);
    expect(r).toEqual({ householdMinor: 50_000_000, otherUseMinor: 100_000_000, transferMinor: 0, closingMinor: 150_000_000 });
  });

  it('payment in cycle: a payment from her own bank is negative other use', () => {
    const r = splitPeriod(200_000_000, [
      { transactionId: 't1', amountMinor: 50_000_000, household: true },
      { transactionId: 'pay', amountMinor: -200_000_000, household: false },
    ]);
    expect(r).toEqual({ householdMinor: 50_000_000, otherUseMinor: -200_000_000, transferMinor: 0, closingMinor: 50_000_000 });
  });

  it('a transfer between partners is its own part, never other use (wave 4 review)', () => {
    const r = splitPeriod(1_000_000, [
      { transactionId: 'h', amountMinor: 300_000, household: true },
      { transactionId: 'x', amountMinor: -5_000_000, household: false, transfer: true },
      { transactionId: 'o', amountMinor: 200_000, household: false },
    ]);
    expect(r).toEqual({ householdMinor: 300_000, otherUseMinor: 200_000, transferMinor: -5_000_000, closingMinor: -3_500_000 });
  });
});

describe('cardBar', () => {
  it('limit 5 jt, household 500 rb, other 1 jt ⇒ 3,5 jt available', () => {
    const bar = cardBar(500_000_000, { openingMinor: 0, householdMinor: 50_000_000, otherUseMinor: 100_000_000, transferMinor: 0, balanceMinor: 150_000_000 });
    expect(bar).toEqual({ householdPct: 10, otherPct: 20, availableMinor: 350_000_000 });
  });

  it('negative other use takes no width', () => {
    const bar = cardBar(500_000_000, { openingMinor: 200_000_000, householdMinor: 50_000_000, otherUseMinor: -200_000_000, transferMinor: 0, balanceMinor: 50_000_000 });
    expect(bar.otherPct).toBe(0);
    expect(bar.availableMinor).toBe(450_000_000);
  });

  it('no limit ⇒ no bar', () =>
    expect(cardBar(0, { openingMinor: 0, householdMinor: 1, otherUseMinor: 1, transferMinor: 0, balanceMinor: 2 })).toEqual({ householdPct: 0, otherPct: 0, availableMinor: -2 }));

  it('the other segment is other use and transfers together, so the bar still adds up', () => {
    // Owes 2,5 jt: 500 rb Household, 1 jt other use, 1 jt a partner charged by transfer (a card's "out", owed more).
    const bar = cardBar(500_000_000, { openingMinor: 0, householdMinor: 50_000_000, otherUseMinor: 100_000_000, transferMinor: 100_000_000, balanceMinor: 250_000_000 });
    expect(bar).toEqual({ householdPct: 10, otherPct: 40, availableMinor: 250_000_000 });
    // A transfer paying the card down offsets other use in the bar.
    expect(cardBar(500_000_000, { openingMinor: 0, householdMinor: 0, otherUseMinor: 100_000_000, transferMinor: -50_000_000, balanceMinor: 50_000_000 }).otherPct).toBe(10);
  });
});

describe('summaryHash', () => {
  it('ignores key order', () => {
    const a = {
      owner: 'r', kind: 'asset', subtype: 'bank', name: 'BCA', currency: 'IDR', balanceMinor: 1, asOf: '2026-09-29', card: null,
      period: { start: '2026-09-01', end: '2026-09-30' }, openingMinor: 0, householdMinor: 0, otherUseMinor: 1, transferMinor: 0, monthEnds: [], tax: null,
    } as const;
    const b = Object.fromEntries(Object.entries(a).reverse());
    expect(summaryHash(a as never)).toBe(summaryHash(b as unknown as ItemSummary));
  });
});

describe('lastMonthEnds', () => {
  it('24 months before September 2026', () => {
    const m = lastMonthEnds('2026-09-29', 24);
    expect(m).toHaveLength(24);
    expect(m[0]).toBe('2024-09');
    expect(m[23]).toBe('2026-08');
  });
});
