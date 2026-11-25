import { describe, expect, it } from 'vitest';
import { averageMonthlyMinor, budgetMonthMinor, budgetTimesIn, daysIn, gridDatesIn, isCountedRepeat, mondaysIn, monthPeriod, perMonthMinor } from '../src/index';

/*
 * Budget C (2026-11-25): a budget typed the way it repeats — a day, a week, every few weeks — is watched by the month.
 * A month's budget is the amount × how many times it comes up in that month. Invented figures.
 */

const NOV = monthPeriod('2026-11');
const DEC = monthPeriod('2026-12');

describe('counting a budget month', () => {
  it('counts every day of the month: 30 in November, 31 in December, 28 in February 2027', () => {
    expect(daysIn(NOV)).toBe(30);
    expect(daysIn(DEC)).toBe(31);
    expect(daysIn(monthPeriod('2027-02'))).toBe(28);
  });

  it('counts the Mondays a month holds: weeks start on Monday — 5 in November 2026, 4 in December', () => {
    // November 2026: Mondays 2, 9, 16, 23, 30. December: 7, 14, 21, 28.
    expect(mondaysIn(NOV)).toBe(5);
    expect(mondaysIn(DEC)).toBe(4);
  });

  it('counts a month that starts on the 25th by its own days', () => {
    // "November" from 25 Oct to 24 Nov: 31 days; Mondays 26 Oct, 2, 9, 16, 23 Nov.
    const period = monthPeriod('2026-11', 25);
    expect(period).toEqual({ from: '2026-10-25', to: '2026-11-24' });
    expect(daysIn(period)).toBe(31);
    expect(mondaysIn(period)).toBe(5);
  });

  it('lays the dates every few weeks from a start date, forwards and back', () => {
    // Every 3 weeks from 3 Nov 2026: 13 Oct, 3 Nov, 24 Nov, 15 Dec, 5 Jan.
    expect(gridDatesIn('2026-11-03', 3, NOV)).toEqual(['2026-11-03', '2026-11-24']);
    expect(gridDatesIn('2026-11-03', 3, DEC)).toEqual(['2026-12-15']);
    expect(gridDatesIn('2026-11-03', 3, monthPeriod('2026-10'))).toEqual(['2026-10-13']);
    expect(gridDatesIn('2026-11-03', 3, monthPeriod('2027-01'))).toEqual(['2027-01-05', '2027-01-26']);
    expect(gridDatesIn('2026-11-03', 2, NOV)).toEqual(['2026-11-03', '2026-11-17']);
  });
});

describe("a budget's month", () => {
  it('a day: 50.000 a day is 1.500.000 in November and 1.550.000 in December', () => {
    const daily = { frequency: 'daily', everyWeeks: null, startsOn: null } as const;
    expect(budgetMonthMinor(50_000, daily, NOV, null)).toBe(1_500_000);
    expect(budgetMonthMinor(50_000, daily, DEC, null)).toBe(1_550_000);
  });

  it("a week: the son's pocket money, 100.000 a week, is 500.000 in November and 400.000 in December", () => {
    const weekly = { frequency: 'weekly', everyWeeks: 1, startsOn: null } as const;
    expect(budgetMonthMinor(100_000, weekly, NOV, null)).toBe(500_000);
    expect(budgetMonthMinor(100_000, weekly, DEC, null)).toBe(400_000);
    // No gap kept is a week.
    expect(budgetMonthMinor(100_000, { frequency: 'weekly', everyWeeks: null, startsOn: null }, NOV, null)).toBe(500_000);
  });

  it('every 3 weeks from 3 Nov: 1.000.000 is 2.000.000 in November and 1.000.000 in December', () => {
    const every3 = { frequency: 'weekly', everyWeeks: 3, startsOn: '2026-11-03' } as const;
    expect(budgetTimesIn(every3, NOV, null)).toBe(2);
    expect(budgetMonthMinor(1_000_000, every3, NOV, null)).toBe(2_000_000);
    expect(budgetMonthMinor(1_000_000, every3, DEC, null)).toBe(1_000_000);
  });

  it("by weeks with the category's bill by the same weeks: the bill's due dates are the budget's", () => {
    // The Electricity bill was bought 3 Nov and then late, on 1 Dec: its November holds one date, December two.
    const every3 = { frequency: 'weekly', everyWeeks: 3, startsOn: '2026-11-03' } as const;
    expect(budgetMonthMinor(1_000_000, every3, NOV, ['2026-11-03'])).toBe(1_000_000);
    expect(budgetMonthMinor(1_000_000, every3, DEC, ['2026-12-01', '2026-12-22'])).toBe(2_000_000);
    // A week follows a weekly bill too: four Thursdays in November, not five Mondays.
    const weekly = { frequency: 'weekly', everyWeeks: 1, startsOn: null } as const;
    expect(budgetMonthMinor(100_000, weekly, NOV, ['2026-11-05', '2026-11-12', '2026-11-19', '2026-11-26'])).toBe(400_000);
  });

  it('a month, a quarter and a year are not counted: they read exactly as they always have', () => {
    for (const frequency of ['monthly', 'quarterly', 'yearly'] as const) {
      const repeat = { frequency, everyWeeks: null, startsOn: null };
      expect(isCountedRepeat(repeat)).toBe(false);
      expect(budgetTimesIn(repeat, NOV, null)).toBeNull();
      expect(budgetMonthMinor(2_400_010, repeat, NOV, null)).toBe(perMonthMinor(2_400_010, frequency));
      expect(budgetMonthMinor(2_400_010, repeat, DEC, ['2026-12-01'])).toBe(perMonthMinor(2_400_010, frequency));
    }
  });

  it('a month that has no date of it comes to nothing', () => {
    const every8 = { frequency: 'weekly', everyWeeks: 8, startsOn: '2026-10-20' } as const;
    // 20 Oct + 8 weeks = 15 Dec: November holds none.
    expect(budgetMonthMinor(1_000_000, every8, NOV, null)).toBe(0);
  });
});

describe('what is kept as the month for a reader that does not count', () => {
  it('is the average month, as before, a few weeks divided by their number', () => {
    expect(averageMonthlyMinor(100_000, 'weekly', 1)).toBe(perMonthMinor(100_000, 'weekly'));
    expect(averageMonthlyMinor(50_000, 'daily', null)).toBe(perMonthMinor(50_000, 'daily'));
    // 1.000.000 × 52 ÷ 12 ÷ 3 = 1.444.444,44.
    expect(averageMonthlyMinor(1_000_000, 'weekly', 3)).toBe(1_444_444);
    expect(averageMonthlyMinor(900_000, 'monthly', null)).toBe(900_000);
  });
});
