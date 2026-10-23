import { describe, expect, it } from 'vitest';
import { averageBoughtAt, dayFraction, goldDots, rangeStart } from './gold-chart';

const trade = (id: string, kind: string, occurredOn: string, grams: number, grossMinor: number) => ({ id, kind, occurredOn, unitsMicro: grams * 1_000_000, grossMinor });

describe('rangeStart', () => {
  it('reaches back the range’s months to the same day, or the month’s last when it is shorter', () => {
    expect(rangeStart('1M', '2026-10-23')).toBe('2026-09-23');
    expect(rangeStart('6M', '2026-10-23')).toBe('2026-04-23');
    expect(rangeStart('1Y', '2026-10-23')).toBe('2025-10-23');
    expect(rangeStart('5Y', '2026-10-23')).toBe('2021-10-23');
    expect(rangeStart('1M', '2026-03-31')).toBe('2026-02-28');
  });
});

describe('dayFraction', () => {
  it('places a day by the calendar across the range, held inside its ends', () => {
    expect(dayFraction('2026-01-01', '2026-01-01', '2026-01-11')).toBe(0);
    expect(dayFraction('2026-01-06', '2026-01-01', '2026-01-11')).toBe(0.5);
    expect(dayFraction('2026-01-11', '2026-01-01', '2026-01-11')).toBe(1);
    expect(dayFraction('2025-12-01', '2026-01-01', '2026-01-11')).toBe(0);
    expect(dayFraction('2026-03-29', '2026-03-28', '2026-03-30')).toBe(0.5);
  });
});

describe('goldDots', () => {
  const trades = [
    trade('old', 'buy', '2024-01-10', 5, 5_000_000),
    trade('b1', 'buy', '2026-02-01', 10, 20_395_000),
    trade('s1', 'sell', '2026-09-30', 2.5, 5_250_000),
    trade('inc', 'income', '2026-05-01', 0, 100_000),
    trade('b2', 'buy', '2026-07-11', 4, 7_800_002),
  ];

  it('draws each buy and sell inside the range at its gross a gram, oldest first', () => {
    expect(goldDots(trades, '2025-10-23', '2026-10-23')).toEqual([
      { id: 'b1', kind: 'buy', on: '2026-02-01', minor: 2_039_500 },
      { id: 'b2', kind: 'buy', on: '2026-07-11', minor: 1_950_000.5 },
      { id: 's1', kind: 'sell', on: '2026-09-30', minor: 2_100_000 },
    ]);
  });

  it('leaves out a trade outside the range, and one with no grams to price', () => {
    expect(goldDots(trades, '2026-03-01', '2026-09-29').map((dot) => dot.id)).toEqual(['b2']);
    expect(goldDots(trades, '2026-02-01', '2026-02-01').map((dot) => dot.id)).toEqual(['b1']);
  });
});

describe('averageBoughtAt', () => {
  it('is the cost over the grams held, and nothing when none are', () => {
    // Rp 22.500.000 for 12 g: Rp 1.875.000 a gram, in millionths of a rupiah.
    expect(averageBoughtAt(22_500_000, 12_000_000)).toBe(1_875_000_000_000);
    expect(averageBoughtAt(0, 0)).toBeNull();
    expect(averageBoughtAt(1_000, -1)).toBeNull();
  });
});
