import type { BillStateKind } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { billLines, changeText, greeting, leftShare, netWorthChange } from './overview-model';

describe('the greeting', () => {
  it('says morning before noon, afternoon until six, evening after', () => {
    expect(greeting(0)).toBe('Good morning');
    expect(greeting(11)).toBe('Good morning');
    expect(greeting(12)).toBe('Good afternoon');
    expect(greeting(17)).toBe('Good afternoon');
    expect(greeting(18)).toBe('Good evening');
    expect(greeting(23)).toBe('Good evening');
  });
});

describe('Left to spend’s badge', () => {
  it('is what is left of what came in, in whole per cent', () => {
    // Received Rp 41.500.000, spent Rp 13.980.000: Rp 27.520.000 left, 66%.
    expect(leftShare(2_752_000_000, 4_150_000_000)).toBe(66);
  });
  it('reads below nought when more went out than came in', () => {
    expect(leftShare(-50_000_00, 1_000_000_00)).toBe(-5);
  });
  it('is not drawn with nothing received, or before the figures are read', () => {
    expect(leftShare(-10_000_00, 0)).toBeNull();
    expect(leftShare(null, 1_000_00)).toBeNull();
    expect(leftShare(1_000_00, null)).toBeNull();
  });
});

describe('Net worth’s change since last month-end', () => {
  it('is today against last month-end, to one decimal', () => {
    // Rp 1,83 M at the end of October, Rp 1,87 M today: up 2,2%.
    expect(netWorthChange(187_000_000_000, 183_000_000_000)).toBe(2.2);
    expect(netWorthChange(99_600_00, 100_000_00)).toBe(-0.4);
  });
  it('measures on the size of a month-end below nought, so up reads as up', () => {
    expect(netWorthChange(-80_000_00, -100_000_00)).toBe(20);
  });
  it('has no percentage from nothing or from a figure not read', () => {
    expect(netWorthChange(5_000_00, 0)).toBeNull();
    expect(netWorthChange(null, 100_00)).toBeNull();
    expect(netWorthChange(100_00, null)).toBeNull();
  });
  it('is written with its sign and a decimal comma', () => {
    expect(changeText(2.1)).toBe('+2,1%');
    expect(changeText(-0.4)).toBe('−0,4%');
    expect(changeText(0)).toBe('0%');
    expect(changeText(12)).toBe('+12%');
  });
});

describe('the bills’ four lines', () => {
  const today = '2026-11-23';
  const bill = (state: BillStateKind, payBy: string) => ({ state, window: { month: '2026-11', opensOn: '2026-11-01', payBy } });
  it('puts each bill in one line: late, due this week, later this month, paid', () => {
    const lines = billLines(
      [
        bill('paid', '2026-11-05'),
        bill('paid', '2026-11-10'),
        bill('overdue', '2026-11-20'),
        bill('dueSoon', '2026-11-25'),
        // Due within Bills' few days, not out yet: due this week, as Bills' Due soon reads it.
        bill('upcoming', '2026-11-26'),
        bill('open', '2026-11-29'),
      ],
      today,
    );
    expect(lines.map((line) => [line.key, line.count])).toEqual([
      ['paid', 2],
      ['week', 2],
      ['later', 1],
      ['late', 1],
    ]);
    expect(lines.map((line) => line.label)).toEqual(['Paid', 'Due this week', 'Later this month', 'Late']);
    expect(lines[0]!.share).toBeCloseTo(2 / 6);
  });
  it('counts a skipped or paused bill nowhere, and the shares are of the rest', () => {
    const lines = billLines([bill('skipped', '2026-11-10'), bill('paused', '2026-11-10'), bill('paid', '2026-11-10')], today);
    expect(lines.map((line) => line.count)).toEqual([1, 0, 0, 0]);
    expect(lines[0]!.share).toBe(1);
  });
  it('draws empty bars with no bills', () => {
    expect(billLines([], today).every((line) => line.count === 0 && line.share === 0)).toBe(true);
  });
});
