import { describe, expect, it } from 'vitest';
import {
  billStanding,
  billWindow,
  currentBillMonth,
  isOwedMonth,
  nextOccurrenceMonth,
  nextOwedMonth,
  payableBillMonths,
  periodicRepeat,
  sinkingPlan,
  yearlyListed,
} from '../src/index';

const owed = (every: number, anchorMonth: number, startsMonth: string, from: string, count: number) => {
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number) as [number, number];
  for (let i = 0; i < count; i += 1) {
    const month = `${y}-${String(m).padStart(2, '0')}`;
    if (isOwedMonth(month, anchorMonth, every, startsMonth)) out.push(month);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
};

describe('owed months of an every-N-months bill', () => {
  it('every 2 months from February', () => {
    expect(owed(2, 2, '2026-02', '2026-01', 12)).toEqual(['2026-02', '2026-04', '2026-06', '2026-08', '2026-10', '2026-12']);
  });
  it('every 3 months from mid-year wraps over the year end', () => {
    expect(owed(3, 8, '2026-08', '2026-08', 12)).toEqual(['2026-08', '2026-11', '2027-02', '2027-05']);
  });
  it('every 6 months from November', () => {
    expect(owed(6, 11, '2026-11', '2026-11', 18)).toEqual(['2026-11', '2027-05', '2027-11']);
  });
  it('a gap that does not divide twelve keeps counting from the first occurrence', () => {
    expect(owed(5, 11, '2026-11', '2026-11', 16)).toEqual(['2026-11', '2027-04', '2027-09', '2028-02']);
  });
  it('the cycle is the same going backwards; callers guard by the first month', () => {
    expect(isOwedMonth('2026-05', 8, 3, '2026-08')).toBe(true);
    expect(isOwedMonth('2026-06', 8, 3, '2026-08')).toBe(false);
  });
  it('monthly and yearly are unchanged', () => {
    expect(isOwedMonth('2026-07', null)).toBe(true);
    expect(isOwedMonth('2026-07', 3)).toBe(false);
    expect(isOwedMonth('2026-03', 3)).toBe(true);
    expect(isOwedMonth('2026-03', 3, 12)).toBe(true);
    expect(nextOwedMonth('2026-04', 3)).toBe('2027-03');
    expect(nextOwedMonth('2026-03', 3)).toBe('2026-03');
  });
  it('nextOwedMonth finds the next occurrence', () => {
    expect(nextOwedMonth('2026-09', 8, 3, '2026-08')).toBe('2026-11');
    expect(nextOwedMonth('2026-11', 8, 3, '2026-08')).toBe('2026-11');
    expect(nextOwedMonth('2026-12', 8, 3, '2026-08')).toBe('2027-02');
    expect(nextOwedMonth('2026-01', 8, 3, '2026-08')).toBe('2026-08');
  });
});

describe('the month a periodic bill speaks for', () => {
  const base = { startsMonth: '2026-08', outDay: 12, payByDay: null, settled: {}, yearlyMonth: 8, repeatEvery: 3 };
  it('its next occurrence between occurrences', () => {
    expect(currentBillMonth({ ...base, today: '2026-09-20', settled: { '2026-08': 'paid' } })).toBe('2026-11');
    expect(currentBillMonth({ ...base, today: '2026-12-20', settled: { '2026-08': 'paid', '2026-11': 'paid' } })).toBe('2027-02');
  });
  it('last month while an occurrence is unsettled, then not', () => {
    expect(currentBillMonth({ ...base, today: '2026-09-02' })).toBe('2026-08');
    expect(currentBillMonth({ ...base, today: '2026-10-02' })).toBe('2026-11');
  });
  it('payable months are only owed ones', () => {
    expect(payableBillMonths({ ...base, today: '2026-09-02' })).toEqual(['2026-08', '2026-11']);
    expect(payableBillMonths({ ...base, today: '2026-10-02' })).toEqual(['2026-11']);
    expect(payableBillMonths({ ...base, today: '2026-09-02', settled: { '2026-08': 'paused' } })).toEqual(['2026-11', '2026-08']);
    expect(payableBillMonths({ ...base, today: '2026-09-02', settled: { '2026-08': 'paid' } })).toEqual(['2026-11']);
  });
  it('lists only within 30 days of its date, or when out and unpaid', () => {
    const listed = (today: string, settled = {}) => {
      const month = currentBillMonth({ ...base, today, settled });
      const window = billWindow(month, 12, null);
      return yearlyListed(billStanding(window, today, (settled as Record<string, 'paid'>)[month] ?? null), window, today);
    };
    expect(listed('2026-10-13')).toBe(true); // 30 days to 12 Nov
    expect(listed('2026-10-12')).toBe(false);
    expect(listed('2026-11-12')).toBe(true);
    expect(listed('2026-09-05')).toBe(true); // August's is unpaid and still late
    expect(listed('2026-09-05', { '2026-08': 'paid' })).toBe(false);
  });
  it('due by in the following month', () => {
    const window = billWindow('2026-11', 28, 5);
    expect(window).toMatchObject({ opensOn: '2026-11-28', payBy: '2026-12-05' });
    expect(billStanding(window, '2026-12-05', null).state).toBe('dueSoon');
    expect(billStanding(window, '2026-12-06', null)).toMatchObject({ state: 'overdue', days: 1 });
  });
});

describe('first occurrence and sinking fund', () => {
  it('a bill made after this period\'s first occurrence starts at the next one', () => {
    expect(nextOccurrenceMonth('2026-10-27', 10, 5)).toBe('2027-10');
    expect(nextOccurrenceMonth('2026-10-27', 12, 5)).toBe('2026-12');
  });
  it('with a known first month it counts the cycle on', () => {
    expect(nextOccurrenceMonth('2026-09-10', 8, 12, 3, '2026-08')).toBe('2026-11');
    expect(nextOccurrenceMonth('2026-11-20', 8, 12, 3, '2026-08')).toBe('2027-02');
    expect(nextOccurrenceMonth('2026-11-12', 8, 12, 3, '2026-08')).toBe('2026-11');
  });
  it('the fund saves toward the next occurrence', () => {
    const plan = sinkingPlan({ targetMinor: 900_000, today: '2026-09-10', repeatMonth: 8, dayOfMonth: 12, currency: 'IDR', repeatEvery: 3, startsMonth: '2026-08' });
    expect(plan).toMatchObject({ dueMonth: '2026-11', monthsLeft: 2 });
  });
  it('wording', () => {
    expect(periodicRepeat(3, 3, 12)).toBe('Every 3 months · from March, the 12th');
  });
});
