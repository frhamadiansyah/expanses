import { describe, expect, it } from 'vitest';
import { type DayTotal, parsePeriod, spendingComparisons, spendingTrend, trendWindow } from '../src/index';

const period = (value: string) => parsePeriod(value)!;
/** One amount on each of the given days. */
const on = (...pairs: [string, number][]): DayTotal[] => pairs.map(([date, amountMinor]) => ({ date, amountMinor }));
/** The same amount on every day from `from` to `to`. */
function everyDay(from: string, to: string, amountMinor: number): DayTotal[] {
  const days: DayTotal[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    days.push({ date: d.toISOString().slice(0, 10), amountMinor });
  }
  return days;
}
const past = { today: '2026-10-03', first: '2024-01-01' };

describe('spendingTrend', () => {
  it('draws a week as its seven days, named by weekday', () => {
    const trend = spendingTrend(period('2026-W39'), on(['2026-09-25', 2_940_000], ['2026-09-26', 610_000]), past);
    expect(trend.unit).toBe('day');
    expect(trend.bars.map((bar) => bar.tick)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(trend.bars.map((bar) => bar.totalMinor)).toEqual([0, 0, 0, 0, 2_940_000, 610_000, 0]);
    // Week 39 of 2026 is Monday 21 to Sunday 27 September.
    expect(trend.bars[4]).toMatchObject({ from: '2026-09-25', to: '2026-09-25', label: 'Fri 25 Sep' });
  });

  it('draws a month as its days, numbered', () => {
    const trend = spendingTrend(period('2026-09'), on(['2026-09-12', 980_000], ['2026-10-01', 5]), past);
    expect(trend.unit).toBe('day');
    expect(trend.bars).toHaveLength(30);
    expect(trend.bars[0]!.tick).toBe('1');
    expect(trend.bars[11]).toMatchObject({ label: 'Sat 12 Sep', totalMinor: 980_000 });
    // October's amount is not September's.
    expect(trend.bars.reduce((sum, bar) => sum + (bar.totalMinor ?? 0), 0)).toBe(980_000);
  });

  it('draws a quarter as its weeks, Monday to Sunday, cut at the quarter’s edges', () => {
    const trend = spendingTrend(period('2026-Q3'), on(['2026-07-01', 100], ['2026-07-06', 200], ['2026-09-30', 300]), past);
    expect(trend.unit).toBe('week');
    // 1 July 2026 is a Wednesday: the first week is cut to Wednesday–Sunday, the last to Monday 28 – Wednesday 30.
    expect(trend.bars).toHaveLength(14);
    expect(trend.bars[0]).toMatchObject({ from: '2026-07-01', to: '2026-07-05', label: '1 – 5 Jul', totalMinor: 100 });
    expect(trend.bars[1]).toMatchObject({ from: '2026-07-06', to: '2026-07-12', label: '6 – 12 Jul', totalMinor: 200 });
    expect(trend.bars[4]).toMatchObject({ label: '27 Jul – 2 Aug' });
    expect(trend.bars[13]).toMatchObject({ from: '2026-09-28', to: '2026-09-30', totalMinor: 300 });
  });

  it('draws a year as its months, and leaves the months still to come empty', () => {
    const trend = spendingTrend(period('2026'), on(['2026-09-12', 980_000], ['2026-10-02', 70_000]), past);
    expect(trend.unit).toBe('month');
    expect(trend.bars.map((bar) => bar.tick)).toEqual(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);
    expect(trend.bars[8]).toMatchObject({ label: 'September 2026', totalMinor: 980_000, partial: false });
    // October is under way: counted so far, and marked as not finished.
    expect(trend.bars[9]).toMatchObject({ label: 'October 2026', totalMinor: 70_000, partial: true });
    // November has not happened: there is nothing to draw, which is not the same as nothing spent.
    expect(trend.bars[10]!.totalMinor).toBeNull();
  });

  it('draws a day still to come when something is already counted on it, as the donut counts it', () => {
    // A bill paid early is counted on its own out day, after today: the month's ring has it, so its bar does too.
    const trend = spendingTrend(period('2026-10'), on(['2026-10-05', 450_000], ['2026-10-02', 70_000]), past);
    expect(trend.bars[4]).toMatchObject({ from: '2026-10-05', totalMinor: 450_000 });
    expect(trend.bars[5]!.totalMinor).toBeNull();
    expect(trend.bars.reduce((sum, bar) => sum + (bar.totalMinor ?? 0), 0)).toBe(520_000);
  });

  it('draws all time from the first transaction to today, by month while it is short and by year once it is long', () => {
    const short = spendingTrend(period('all'), on(['2025-11-03', 10]), { today: '2026-10-03', first: '2025-11-03' });
    expect(short.unit).toBe('month');
    expect(short.bars.map((bar) => bar.tick)).toEqual(['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct']);
    expect(short.bars[0]).toMatchObject({ from: '2025-11-03', totalMinor: 10 });

    const long = spendingTrend(period('all'), on(['2022-05-01', 10], ['2026-01-01', 20]), { today: '2026-10-03', first: '2022-05-01' });
    expect(long.unit).toBe('year');
    expect(long.bars.map((bar) => [bar.label, bar.totalMinor])).toEqual([
      ['2022', 10],
      ['2023', 0],
      ['2024', 0],
      ['2025', 0],
      ['2026', 20],
    ]);
  });

  it('draws nothing for all time before anything was recorded', () => {
    expect(spendingTrend(period('all'), [], { today: '2026-10-03', first: null }).bars).toEqual([]);
  });

  it('picks the unit for two chosen dates by how long the stretch is', () => {
    expect(spendingTrend(period('2026-09-01..2026-09-20'), [], past).unit).toBe('day');
    expect(spendingTrend(period('2026-07-01..2026-09-30'), [], past).unit).toBe('week');
    expect(spendingTrend(period('2025-01-01..2026-09-30'), [], past).unit).toBe('month');
    expect(spendingTrend(period('2020-01-01..2026-09-30'), [], past).unit).toBe('year');
  });
});

describe('spendingComparisons', () => {
  it('sets a finished month against the month before, the same month last year, and the usual month', () => {
    const days = [
      ...everyDay('2025-09-01', '2025-09-30', 100), // 3.000 last September
      ...everyDay('2026-03-01', '2026-08-31', 100), // the six months before, 100 a day
      ...everyDay('2026-09-01', '2026-09-30', 120), // 3.600 this September
    ];
    const comparisons = spendingComparisons(period('2026-09'), days, past);
    expect(comparisons.map((c) => [c.key, c.label, c.againstMinor, c.changePercent, c.period])).toEqual([
      ['previous', 'August', 3_100, 16, '2026-08'],
      ['year-ago', 'Sep 2025', 3_000, 20, '2025-09'],
      // March to August average 3.066,67 a month.
      ['usual', 'usual month', 3_067, 17, null],
    ]);
  });

  it('compares a period still running over the same number of days', () => {
    // Three days into October: October 1–3 is set against September 1–3, not all of September.
    const days = [...everyDay('2026-09-01', '2026-09-30', 100), ...everyDay('2026-10-01', '2026-10-03', 150), ...everyDay('2025-10-01', '2025-10-31', 100)];
    const [previous, yearAgo] = spendingComparisons(period('2026-10'), days, { today: '2026-10-03', first: '2025-01-01' });
    expect(previous).toMatchObject({ label: 'September', againstMinor: 300, changePercent: 50 });
    expect(yearAgo).toMatchObject({ label: 'Oct 2025', againstMinor: 300, changePercent: 50 });
  });

  it('compares a year with the two before it, and has no usual year', () => {
    const days = everyDay('2023-01-01', '2026-12-31', 1);
    expect(spendingComparisons(period('2025'), days, { today: '2026-10-03', first: '2023-01-01' }).map((c) => [c.key, c.label, c.period])).toEqual([
      ['previous', '2024', '2024'],
      ['year-ago', '2023', '2023'],
    ]);
    // 2023 is from before anything was recorded here, so only 2024 is left to compare with.
    expect(spendingComparisons(period('2025'), days, past).map((c) => c.key)).toEqual(['previous']);
  });

  it('names weeks and quarters the way the picker does', () => {
    const days = everyDay('2024-01-01', '2026-10-03', 10);
    expect(spendingComparisons(period('2026-W39'), days, past).map((c) => c.label)).toEqual(['last week', 'same week 2025', 'usual week']);
    expect(spendingComparisons(period('2026-Q3'), days, past).map((c) => c.label)).toEqual(['Q2 2026', 'Q3 2025', 'usual quarter']);
  });

  it('leaves out a period from before anything was recorded, and anything it would divide by nothing', () => {
    const first = '2026-08-15';
    const days = [...everyDay('2026-08-15', '2026-08-31', 100), ...everyDay('2026-09-01', '2026-09-30', 100)];
    // August only half happened in the app, so it is not a fair month to set September against; neither is last year.
    expect(spendingComparisons(period('2026-09'), days, { today: '2026-10-03', first })).toEqual([]);
    // Nothing at all spent the month before is not a change of infinity per cent.
    expect(spendingComparisons(period('2026-09'), everyDay('2026-09-01', '2026-09-30', 1), past).map((c) => c.key)).toEqual([]);
  });

  it('needs three earlier periods before it will call anything usual', () => {
    const days = everyDay('2026-06-01', '2026-09-30', 100);
    expect(spendingComparisons(period('2026-09'), days, { today: '2026-10-03', first: '2026-07-01' }).map((c) => c.key)).toEqual(['previous']);
    expect(spendingComparisons(period('2026-09'), days, { today: '2026-10-03', first: '2026-06-01' }).map((c) => c.key)).toEqual(['previous', 'usual']);
  });

  it('has nothing to compare for a period that has not started', () => {
    expect(spendingComparisons(period('2026-11'), everyDay('2024-01-01', '2026-10-03', 10), past)).toEqual([]);
  });

  it('has nothing to compare for all time or two chosen dates', () => {
    expect(spendingComparisons(period('all'), [], past)).toEqual([]);
    expect(spendingComparisons(period('2026-07-01..2026-09-17'), [], past)).toEqual([]);
  });
});

describe('trendWindow', () => {
  it('reaches back far enough for every comparison, and no further than the period’s end', () => {
    // A month needs the six before it and the same month a year ago.
    expect(trendWindow(period('2026-09'), past)).toEqual({ from: '2025-09-01', to: '2026-09-30' });
    // A year needs the two before it.
    expect(trendWindow(period('2026'), past)).toEqual({ from: '2024-01-01', to: '2026-12-31' });
    expect(trendWindow(period('all'), { today: '2026-10-03', first: '2025-11-03' })).toEqual({ from: '2025-11-03', to: '2026-10-03' });
    expect(trendWindow(period('all'), { today: '2026-10-03', first: null })).toBeNull();
  });
});
