import { describe, expect, it } from 'vitest';
import {
  accountBars,
  averageOf,
  chartMonths,
  expectedLegend,
  expectedSpending,
  firstMonth,
  howLongItLasts,
  monthsBetween,
  monthsText,
  nextFortnight,
  projectedBalance,
  rangeLabel,
  targetMonths,
  worthALook,
} from './overview-model';

describe('Expected spending', () => {
  it('is the monthly budget when one is set', () => {
    expect(expectedSpending(30_000_000, [10, 20, 30])).toEqual({ kind: 'budget', minor: 30_000_000 });
  });

  it('else the average of the last three full months, of those known', () => {
    expect(expectedSpending(0, [30_000_000, 36_000_000, null])).toEqual({ kind: 'average', minor: 33_000_000 });
    expect(expectedSpending(null, [null, null, null])).toEqual({ kind: 'none' });
  });

  it('says which in the legend', () => {
    expect(expectedLegend({ kind: 'budget', minor: 1 })).toBe('Expected: the monthly budget');
    expect(expectedLegend({ kind: 'average', minor: 1 })).toBe('Expected: average of the last 3 months');
    expect(expectedLegend({ kind: 'none' })).toBe('Expected: nothing to go on yet');
  });

  it('averages to a whole minor unit', () => {
    expect(averageOf([1, 2])).toBe(2);
    expect(averageOf([])).toBeNull();
  });
});

describe('the 12-month chart', () => {
  const spent = { '2026-06': 31_000_000, '2026-07': 29_000_000, '2026-08': 40_500_000, '2026-09': 33_000_000, '2026-10': 40_500_000, '2026-11': 12_000_000 };

  it('draws six months up to this one as spent, the highest once in orange, then six expected', () => {
    const months = chartMonths({ first: '2026-06', current: '2026-11', spent, expected: { kind: 'average', minor: 34_000_000 }, balanceAhead: () => null });
    expect(months.map((m) => m.month)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04', '2027-05']);
    expect(months.map((m) => m.kind)).toEqual(['spent', 'spent', 'highest', 'spent', 'spent', 'spent', ...Array(6).fill('expected')]);
    expect(months[6]!.minor).toBe(34_000_000);
  });

  it('puts the projected balance on the months ahead only', () => {
    const line = projectedBalance(100_000_000, 40_000_000, 34_000_000);
    const months = chartMonths({ first: '2026-06', current: '2026-11', spent, expected: { kind: 'none' }, balanceAhead: line });
    expect(months[5]!.balanceMinor).toBeNull();
    expect(months[6]!.balanceMinor).toBe(106_000_000);
    expect(months[11]!.balanceMinor).toBe(136_000_000);
    expect(months[6]!.minor).toBeNull();
  });

  it('draws no line when income, spending or the money on hand is unknown', () => {
    expect(projectedBalance(null, 1, 1)(1)).toBeNull();
    expect(projectedBalance(1, null, 1)(1)).toBeNull();
    expect(projectedBalance(1, 1, null)(1)).toBeNull();
  });

  it('marks no highest month when nothing was spent', () => {
    const months = chartMonths({ first: '2026-06', current: '2026-11', spent: {}, expected: { kind: 'none' }, balanceAhead: () => null });
    expect(months.some((m) => m.kind === 'highest')).toBe(false);
  });

  it('moves the window and names it', () => {
    expect(firstMonth('2026-11', 0)).toBe('2026-06');
    expect(firstMonth('2026-11', -1)).toBe('2026-05');
    expect(rangeLabel('2026-06')).toBe('Jun 2026 – May 2027');
    expect(monthsBetween('2026-11', '2027-02')).toBe(3);
  });
});

describe('how long it lasts', () => {
  it('divides the money on hand by the average month and names the month it runs out', () => {
    const lasts = howLongItLasts(142_800_000, 34_000_000, 6, '2026-11');
    expect(lasts.months).toBe(4.2);
    expect(lasts.until).toBe('Mar 2027');
    expect(lasts.share).toBeCloseTo(0.7);
  });

  it('caps the gauge at the target and says nothing with nothing to divide by', () => {
    expect(howLongItLasts(1_000_000_000, 10_000_000, 6, '2026-11').share).toBe(1);
    expect(howLongItLasts(1, null, 6, '2026-11')).toEqual({ months: null, until: null, share: 0 });
    expect(howLongItLasts(1, 0, 6, '2026-11').months).toBeNull();
  });

  it('reads the target from the emergency goal, else six months', () => {
    expect(targetMonths(9)).toBe(9);
    expect(targetMonths(null)).toBe(6);
    expect(monthsText(4.2)).toBe('4,2 mo');
  });
});

describe('the accounts bars', () => {
  it('sorts by size in the base currency and draws each against the largest', () => {
    const bars = accountBars([
      { id: 'a', name: 'GoPay', minor: 1_900_000, currency: 'IDR', baseMinor: 1_900_000 },
      { id: 'b', name: 'Bank Satu', minor: 142_500_000, currency: 'IDR', baseMinor: 142_500_000 },
      { id: 'c', name: 'Dollar', minor: 184_000, currency: 'USD', baseMinor: 28_500_000 },
      { id: 'd', name: 'No rate', minor: 5_00, currency: 'TRY', baseMinor: null },
    ]);
    expect(bars.map((bar) => [bar.name, Math.round(bar.share * 100)])).toEqual([
      ['Bank Satu', 100],
      ['Dollar', 20],
      ['GoPay', 1],
      ['No rate', 0],
    ]);
  });
});

describe('worth a look', () => {
  const none = { review: 0, late: 0, over: 0, billsSoon: 0, backupDays: 1, hasData: true };

  it('is empty when nothing is counted', () => {
    expect(worthALook(none)).toEqual([]);
  });

  it('lists what the app counts, most pressing first, three at most, each to its page', () => {
    const items = worthALook({ review: 4, late: 2, over: 1, billsSoon: 1, backupDays: null, hasData: true });
    expect(items.map((item) => [item.title, item.to])).toEqual([
      ['2 debts late', '/net-worth/plan'],
      ['1 bill due within 3 days', '/bills'],
      ['4 purchases to review', '/review'],
    ]);
  });

  it('asks for a backup only with data and none for a week', () => {
    expect(worthALook({ ...none, backupDays: 9 }).map((item) => item.title)).toEqual(['Last backup 9 days ago']);
    expect(worthALook({ ...none, backupDays: null, hasData: false })).toEqual([]);
    expect(worthALook({ ...none, over: 1 }).map((item) => item.title)).toEqual(['1 budget category over']);
  });
});

describe('the next 14 days', () => {
  const item = (key: string, dueOn: string, status: 'paid' | 'late' | 'upcoming' = 'upcoming') => ({ key, dueOn, status, title: key, minor: 1, currency: 'IDR' });

  it('keeps what is unpaid and due from today to 14 days on, soonest first, once each', () => {
    const rows = nextFortnight([item('c', '2026-12-01'), item('a', '2026-11-17'), item('paid', '2026-11-20', 'paid'), item('late', '2026-11-10', 'late'), item('far', '2026-12-02'), item('a', '2026-11-17')], '2026-11-17');
    expect(rows.map((row) => [row.title, row.dueOn])).toEqual([
      ['a', '2026-11-17'],
      ['c', '2026-12-01'],
    ]);
  });
});
