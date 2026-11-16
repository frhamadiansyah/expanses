import { describe, expect, it } from 'vitest';
import { type CardInstallment, instalmentSpendingLines, instalmentsCountedIn, periodMonthOf, splitByParts } from '../src/index';

/** Invented: a laptop of Rp 12.000.000 over 12 months, first billed December 2026, statement day the 18th. */
const laptop: CardInstallment = {
  totalMinor: 12_000_000,
  months: 12,
  monthlyMinor: 1_000_000,
  firstBilledMonth: '2026-12',
  rateBps: 0,
  conversionFeeMinor: 0,
  earnsPoints: true,
};

describe('splitByParts', () => {
  it('gives one part the whole amount', () => {
    expect(splitByParts(1_000_000, [{ key: 'a', weight: 12_000_000 }])).toEqual([{ key: 'a', amountMinor: 1_000_000 }]);
  });

  it('splits by weight and keeps the parts adding back to the amount', () => {
    const parts = splitByParts(1_000_000, [
      { key: 'a', weight: 1 },
      { key: 'b', weight: 1 },
      { key: 'c', weight: 1 },
    ]);
    expect(parts.map((p) => p.amountMinor).reduce((s, n) => s + n, 0)).toBe(1_000_000);
    expect(parts.map((p) => p.amountMinor).sort()).toEqual([333_333, 333_333, 333_334]);
  });

  it('counts a share of the amount when only some of the weight is asked for', () => {
    // An 8 + 4 purchase read in the workspace that holds the 8: two thirds of each instalment.
    expect(splitByParts(1_000_000, [{ key: 'a', weight: 8 }], 12)).toEqual([{ key: 'a', amountMinor: 666_667 }]);
  });

  it('gives nothing for no weight', () => {
    expect(splitByParts(1_000_000, [])).toEqual([]);
    expect(splitByParts(1_000_000, [{ key: 'a', weight: 0 }])).toEqual([]);
  });
});

describe('instalmentSpendingLines', () => {
  it('counts each instalment on its statement date in the purchase category', () => {
    const lines = instalmentSpendingLines(laptop, 18, [{ key: 'electronics', weight: 12_000_000 }]);
    expect(lines).toHaveLength(12);
    expect(lines[0]).toEqual({ number: 1, of: 12, statementOn: '2026-12-18', categoryKey: 'electronics', amountMinor: 1_000_000 });
    expect(lines[11]).toMatchObject({ number: 12, statementOn: '2027-11-18', amountMinor: 1_000_000 });
    expect(lines.reduce((s, l) => s + l.amountMinor, 0)).toBe(12_000_000);
  });

  it('puts the rounding on the last instalment', () => {
    const sofa = { ...laptop, totalMinor: 10_000_000, months: 3, monthlyMinor: 3_333_333 };
    const lines = instalmentSpendingLines(sofa, 18, [{ key: 'home', weight: 1 }]);
    expect(lines.map((l) => l.amountMinor)).toEqual([3_333_333, 3_333_333, 3_333_334]);
  });

  it('uses the month end when the statement day does not exist', () => {
    const lines = instalmentSpendingLines({ ...laptop, firstBilledMonth: '2027-02', months: 1, monthlyMinor: 12_000_000 }, 31, [{ key: 'x', weight: 1 }]);
    expect(lines[0]!.statementOn).toBe('2027-02-28');
  });

  it('splits each instalment across a purchase with two categories', () => {
    const lines = instalmentSpendingLines(laptop, 18, [
      { key: 'electronics', weight: 9_000_000 },
      { key: 'software', weight: 3_000_000 },
    ]);
    expect(lines).toHaveLength(24);
    expect(lines.filter((l) => l.number === 1).map((l) => [l.categoryKey, l.amountMinor])).toEqual([
      ['electronics', 750_000],
      ['software', 250_000],
    ]);
    expect(lines.reduce((s, l) => s + l.amountMinor, 0)).toBe(12_000_000);
  });

  it('counts nothing without a category to count in', () => {
    expect(instalmentSpendingLines(laptop, 18, [])).toEqual([]);
  });
});

describe('instalmentsCountedIn', () => {
  it('keeps the instalments whose statement date falls in the range', () => {
    const lines = instalmentSpendingLines(laptop, 18, [{ key: 'electronics', weight: 1 }]);
    expect(instalmentsCountedIn(lines, '2026-11-01', '2026-11-30')).toEqual([]);
    expect(instalmentsCountedIn(lines, '2026-12-01', '2026-12-31').map((l) => l.number)).toEqual([1]);
  });

  it('follows Month starts on: a statement on the 18th counts in the month that holds it', () => {
    const lines = instalmentSpendingLines(laptop, 18, [{ key: 'electronics', weight: 1 }]);
    // Months start on the 25th: "December" is 25 Nov – 24 Dec, so 18 Dec counts in December.
    expect(periodMonthOf('2026-12-18', 25)).toBe('2026-12');
    expect(instalmentsCountedIn(lines, '2026-11-25', '2026-12-24').map((l) => l.number)).toEqual([1]);
    // A statement on the 26th falls in the next named month.
    const late = instalmentSpendingLines(laptop, 26, [{ key: 'electronics', weight: 1 }]);
    expect(periodMonthOf(late[0]!.statementOn, 25)).toBe('2027-01');
    expect(instalmentsCountedIn(late, '2026-11-25', '2026-12-24')).toEqual([]);
  });
});
