import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  addMonths,
  billMonthIn,
  isMonthStartDay,
  MONTH_START_LAST,
  monthOf,
  monthPeriod,
  monthPeriodDates,
  monthRange,
  monthStartLabel,
  monthStartOf,
  parsePeriod,
  periodMonthOf,
} from '../src/index';

const pad = (n: number) => String(n).padStart(2, '0');
const nextDay = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};
const DAYS = [...Array.from({ length: 28 }, (_, i) => i + 1), MONTH_START_LAST];

describe('a month that starts on the 1st is the calendar month, as before the setting', () => {
  it('monthPeriod(…, 1) is monthRange, and periodMonthOf(…, 1) is monthOf, for every month of 2000–2040', () => {
    for (let month = '2000-01'; month <= '2040-12'; month = addMonths(month, 1)) {
      expect(monthPeriod(month, 1)).toEqual(monthRange(month));
      expect(monthPeriod(month)).toEqual(monthRange(month));
      const { from, to } = monthRange(month);
      for (const day of [from, `${month}-15`, to]) expect(periodMonthOf(day, 1)).toBe(monthOf(day));
    }
  });

  it('parsePeriod reads a month the same way with no start day and with 1', () => {
    for (const value of ['2026-02', '2024-02', '2026-11', '2026-12']) expect(parsePeriod(value, 1)).toEqual(parsePeriod(value));
  });
});

describe('starting on the 25th', () => {
  it('"November" is 25 Oct – 24 Nov', () => {
    expect(monthPeriod('2026-11', 25)).toEqual({ from: '2026-10-25', to: '2026-11-24' });
    expect(monthPeriodDates('2026-11', 25)).toBe('25 Oct – 24 Nov');
    expect(monthPeriodDates('2026-12', 25)).toBe('25 Nov – 24 Dec');
  });

  it('January 2027 is 25 Dec 2026 – 24 Jan 2027, over the year end', () => {
    expect(monthPeriod('2027-01', 25)).toEqual({ from: '2026-12-25', to: '2027-01-24' });
    expect(periodMonthOf('2026-12-25', 25)).toBe('2027-01');
    expect(periodMonthOf('2026-12-24', 25)).toBe('2026-12');
  });

  it('a day is in the month whose dates hold it: 25 Oct is November, 25 Nov is December', () => {
    expect(periodMonthOf('2026-10-24', 25)).toBe('2026-10');
    expect(periodMonthOf('2026-10-25', 25)).toBe('2026-11');
    expect(periodMonthOf('2026-11-24', 25)).toBe('2026-11');
    expect(periodMonthOf('2026-11-25', 25)).toBe('2026-12');
  });

  it('March runs from 25 Feb, in a leap year too', () => {
    expect(monthPeriod('2027-03', 25)).toEqual({ from: '2027-02-25', to: '2027-03-24' });
    expect(monthPeriod('2028-03', 25)).toEqual({ from: '2028-02-25', to: '2028-03-24' });
  });
});

describe('the last day of the month', () => {
  it('follows short months: November 31 Oct – 29 Nov, December 30 Nov – 30 Dec, March 28 Feb – 30 Mar', () => {
    expect(monthPeriod('2026-11', MONTH_START_LAST)).toEqual({ from: '2026-10-31', to: '2026-11-29' });
    expect(monthPeriod('2026-12', MONTH_START_LAST)).toEqual({ from: '2026-11-30', to: '2026-12-30' });
    expect(monthPeriod('2027-03', MONTH_START_LAST)).toEqual({ from: '2027-02-28', to: '2027-03-30' });
  });

  it('in a leap year February ends on the 28th and March starts on the 29th', () => {
    expect(monthPeriod('2028-02', MONTH_START_LAST)).toEqual({ from: '2028-01-31', to: '2028-02-28' });
    expect(monthPeriod('2028-03', MONTH_START_LAST)).toEqual({ from: '2028-02-29', to: '2028-03-30' });
    expect(periodMonthOf('2028-02-28', MONTH_START_LAST)).toBe('2028-02');
    expect(periodMonthOf('2028-02-29', MONTH_START_LAST)).toBe('2028-03');
  });

  it('is said "Last day"', () => {
    expect(monthStartLabel(MONTH_START_LAST)).toBe('Last day');
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 25, 28].map(monthStartLabel)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '25th', '28th']);
  });
});

describe('a month is named after the month most of it falls in', () => {
  it('starting on the 15th or earlier, it begins in the named month', () => {
    expect(monthPeriod('2026-11', 5)).toEqual({ from: '2026-11-05', to: '2026-12-04' });
    expect(monthPeriod('2026-11', 15)).toEqual({ from: '2026-11-15', to: '2026-12-14' });
    expect(periodMonthOf('2026-12-04', 5)).toBe('2026-11');
    expect(periodMonthOf('2026-11-04', 5)).toBe('2026-10');
  });

  it('starting on the 16th or later, it ends in the named month', () => {
    expect(monthPeriod('2026-11', 16)).toEqual({ from: '2026-10-16', to: '2026-11-15' });
    expect(monthPeriod('2026-02', 28)).toEqual({ from: '2026-01-28', to: '2026-02-27' });
    expect(monthPeriod('2026-03', 28)).toEqual({ from: '2026-02-28', to: '2026-03-27' });
  });
});

describe('every start day, every month', () => {
  it('months follow one another with no gap and no overlap, and every day is in the month whose dates hold it', () => {
    for (const day of DAYS) {
      for (let month = '2023-11'; month <= '2029-02'; month = addMonths(month, 1)) {
        const { from, to } = monthPeriod(month, day);
        expect(from <= to).toBe(true);
        expect(nextDay(to)).toBe(monthPeriod(addMonths(month, 1), day).from);
        expect(periodMonthOf(from, day)).toBe(month);
        expect(periodMonthOf(to, day)).toBe(month);
      }
    }
  });

  it('periodMonthOf is the month whose period holds the day (random days)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 365 * 40 }), fc.constantFrom(...DAYS), (offset, day) => {
        const date = new Date(Date.UTC(2000, 0, 1 + offset)).toISOString().slice(0, 10);
        const { from, to } = monthPeriod(periodMonthOf(date, day), day);
        return from <= date && date <= to;
      }),
    );
  });
});

describe('a bill keeps its day and counts in the month its date falls in', () => {
  it('with months from the 25th, a bill on the 27th is November’s by its October bill, one on the 5th by its November bill', () => {
    expect(billMonthIn('2026-11', 27, 25)).toBe('2026-10');
    expect(billMonthIn('2026-11', 25, 25)).toBe('2026-10');
    expect(billMonthIn('2026-11', 24, 25)).toBe('2026-11');
    expect(billMonthIn('2026-11', 5, 25)).toBe('2026-11');
    expect(billMonthIn('2027-01', 31, 25)).toBe('2026-12');
  });

  it('starting on the 1st, the bill month is the month itself', () => {
    for (const out of [1, 15, 28, 31]) expect(billMonthIn('2026-11', out, 1)).toBe('2026-11');
  });

  it('for any start day from the 1st to the 28th, exactly one occurrence falls in each month', () => {
    for (const day of DAYS.filter((d) => d <= 28)) {
      for (const out of [1, 10, 24, 25, 28, 29, 30, 31]) {
        for (let month = '2026-01'; month <= '2028-12'; month = addMonths(month, 1)) {
          const bill = billMonthIn(month, out, day);
          const [y, m] = bill.split('-').map(Number) as [number, number];
          const date = `${bill}-${pad(Math.min(out, new Date(Date.UTC(y, m, 0)).getUTCDate()))}`;
          expect(periodMonthOf(date, day)).toBe(month);
        }
      }
    }
  });
});

describe('a kept value', () => {
  it('anything not offered reads as the 1st', () => {
    for (const bad of [0, 29, 30, 32, -1, 2.5, NaN, null, undefined, 'x', '']) expect(monthStartOf(bad)).toBe(1);
    expect(monthStartOf(25)).toBe(25);
    expect(monthStartOf('25')).toBe(25);
    expect(monthStartOf(MONTH_START_LAST)).toBe(MONTH_START_LAST);
    expect(isMonthStartDay(29)).toBe(false);
    expect(monthPeriod('2026-11', 30)).toEqual(monthRange('2026-11'));
  });
});

describe('the bills of this month and the Cashflow trend, with months from the 25th', () => {
  it('on 16 Nov, a monthly bill on the 27th speaks for its October bill; on 26 Nov for its November one', async () => {
    const { currentBillMonth, payableBillMonths, thisBillMonth } = await import('../src/index');
    const base = { startsMonth: '2026-01', outDay: 27, payByDay: null, settled: {} as Record<string, 'paid'> };
    expect(thisBillMonth('2026-11-16', 27, 25)).toBe('2026-10');
    expect(thisBillMonth('2026-11-26', 27, 25)).toBe('2026-11');
    expect(thisBillMonth('2026-11-16', 5, 25)).toBe('2026-11');
    expect(currentBillMonth({ ...base, today: '2026-11-16', settled: { '2026-09': 'paid', '2026-10': 'paid' }, startDay: 25 })).toBe('2026-10');
    // The calendar reading, unchanged: November's bill, with October's settled.
    expect(currentBillMonth({ ...base, today: '2026-11-16', settled: { '2026-10': 'paid' } })).toBe('2026-11');
    expect(currentBillMonth({ ...base, today: '2026-11-16', settled: { '2026-10': 'paid' }, startDay: 1 })).toBe('2026-11');
    expect(payableBillMonths({ ...base, today: '2026-11-16', settled: { '2026-09': 'paid', '2026-10': 'paid' }, startDay: 25 })).toEqual(['2026-11']);
  });

  it('the month before is compared by its own name and its own dates', async () => {
    const { spendingComparisons } = await import('../src/index');
    const period = parsePeriod('2026-11', 25)!;
    expect(period).toMatchObject({ from: '2026-10-25', to: '2026-11-24', monthStart: 25 });
    const days = [
      { date: '2026-09-30', amountMinor: 100 },
      { date: '2026-10-01', amountMinor: 200 },
      { date: '2026-10-24', amountMinor: 300 },
      { date: '2026-10-25', amountMinor: 400 },
      { date: '2026-11-24', amountMinor: 500 },
    ];
    const [previous] = spendingComparisons(period, days, { today: '2026-12-01', first: '2026-01-01' });
    // October is 25 Sep – 24 Oct: 100 + 200 + 300.
    expect(previous).toMatchObject({ key: 'previous', label: 'October', againstMinor: 600, period: '2026-10' });
  });
});

describe('every month holds exactly one bill month, for every start day and every out day', () => {
  it('consecutive months take consecutive bill months, and each bill counts on a day inside its month (36 months)', async () => {
    const { billCountedOn } = await import('../src/index');
    for (const day of DAYS) {
      for (let out = 1; out <= 31; out += 1) {
        let previous: string | null = null;
        for (let month = '2026-01'; month <= '2028-12'; month = addMonths(month, 1)) {
          const bill = billMonthIn(month, out, day);
          if (previous !== null) expect([day, out, month, bill]).toEqual([day, out, month, addMonths(previous, 1)]);
          previous = bill;
          expect([day, out, month, periodMonthOf(billCountedOn(bill, out, day), day)]).toEqual([day, out, month, month]);
        }
      }
    }
  });

  it('from the last day, a bill on the 31st counts by the one on the month’s first day; one on the 30th by the month’s own', async () => {
    const { billCountedOn } = await import('../src/index');
    expect(billMonthIn('2026-11', 31, MONTH_START_LAST)).toBe('2026-10');
    expect(billCountedOn('2026-10', 31, MONTH_START_LAST)).toBe('2026-10-31');
    expect(billMonthIn('2026-11', 30, MONTH_START_LAST)).toBe('2026-11');
    expect(billMonthIn('2026-12', 30, MONTH_START_LAST)).toBe('2026-12');
    // 30 Nov starts December, so November's bill on the 30th counts the day before.
    expect(billCountedOn('2026-11', 30, MONTH_START_LAST)).toBe('2026-11-29');
    expect(billMonthIn('2027-03', 29, MONTH_START_LAST)).toBe('2027-03');
    expect(billCountedOn('2027-02', 29, MONTH_START_LAST)).toBe('2027-02-27');
    // Starting on the 1st, the out day as always.
    expect(billCountedOn('2027-02', 30, 1)).toBe('2027-02-28');
  });
});

describe('a purchase linked to a bill goes to the bill month of its own month', () => {
  it('from the 25th, internet on the 27th bought on 3 Nov links its October bill; on the 1st, November’s', async () => {
    const { linkChoice } = await import('../src/index');
    const input = { today: '2026-11-16', startsMonth: '2026-01', outDay: 27, payByDay: null, settled: {} };
    expect(linkChoice('2026-11-03', { ...input, startDay: 25 })).toEqual({ month: '2026-10', ask: false });
    expect(linkChoice('2026-11-26', { ...input, startDay: 25 })).toEqual({ month: '2026-11', ask: false });
    expect(linkChoice('2026-11-03', input)).toEqual({ month: '2026-11', ask: false });
    expect(linkChoice('2026-11-03', { ...input, startDay: 1 })).toEqual({ month: '2026-11', ask: false });
  });

  it('with a pay-by day, the window is read around that month: out 27 Oct, pay by 5 Nov, paid 3 Nov is October’s', async () => {
    const { linkChoice } = await import('../src/index');
    const input = { today: '2026-11-16', startsMonth: '2026-01', outDay: 27, payByDay: 5, settled: {}, startDay: 25 };
    expect(linkChoice('2026-11-03', input)).toEqual({ month: '2026-10', ask: false });
    expect(linkChoice('2026-11-28', input)).toEqual({ month: '2026-11', ask: false });
  });
});
