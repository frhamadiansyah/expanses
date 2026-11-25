import { monthPeriod } from '@expanses/core';
import type { BudgetMonth, BudgetRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { BUDGET_UNITS, monthFigureOf, perMonthPreview, repeatLine, repeatOfUnit, unitOf, unitWord } from './frequency-form';

const NOV: BudgetMonth = { period: monthPeriod('2026-11'), bills: {} };
const DEC: BudgetMonth = { period: monthPeriod('2026-12'), bills: {} };

describe('the month row', () => {
  it('reads the typed figure with parseMajor and converts it once', () => {
    // Without the month's days, a week is its average month; a year is a twelfth of it.
    expect(perMonthPreview('500.000', 'weekly', 'IDR')).toBe(2_166_667);
    expect(perMonthPreview('10,00', 'weekly', 'USD')).toBe(4_333);
    expect(perMonthPreview('2.400.000', 'yearly', 'IDR')).toBe(200_000);
  });

  it('counts a day or a week in the month on screen (Budget C)', () => {
    const at = (month: BudgetMonth, startsOn: string | null = null) => ({ month, categoryId: 'pocket', startsOn });
    expect(perMonthPreview('100.000', 'weekly', 'IDR', at(NOV))).toBe(500_000);
    expect(perMonthPreview('100.000', 'weekly', 'IDR', at(DEC))).toBe(400_000);
    expect(perMonthPreview('50.000', 'daily', 'IDR', at(NOV))).toBe(1_500_000);
    expect(perMonthPreview('1.000.000', 'weeks-3', 'IDR', at(NOV, '2026-11-03'))).toBe(2_000_000);
    expect(perMonthPreview('1.000.000', 'weeks-3', 'IDR', at(DEC, '2026-11-03'))).toBe(1_000_000);
    // A year is never counted.
    expect(perMonthPreview('2.400.000', 'yearly', 'IDR', at(NOV))).toBe(200_000);
  });

  it("follows the category's bill by the same weeks", () => {
    const month: BudgetMonth = { ...NOV, bills: { power: [{ name: 'Electricity', everyWeeks: 3, dates: ['2026-11-03'] }] } };
    expect(monthFigureOf(1_000_000, 'weeks-3', { month, categoryId: 'power', startsOn: '2026-11-02' })).toBe(1_000_000);
    // Another gap keeps its own dates: 2, 16, 30 Nov.
    expect(monthFigureOf(500_000, 'weeks-2', { month, categoryId: 'power', startsOn: '2026-11-02' })).toBe(1_500_000);
  });

  it('shows nothing while the figure cannot be read', () => {
    expect(perMonthPreview('', 'weekly', 'IDR')).toBeNull();
    expect(perMonthPreview('abc', 'weekly', 'IDR')).toBeNull();
    expect(perMonthPreview('10,50', 'weekly', 'IDR')).toBeNull();
  });
});

describe('the Every list', () => {
  it('offers a day, a week, every 2 to 8 weeks, a month, a quarter and a year', () => {
    expect(BUDGET_UNITS.map(unitWord)).toEqual(['Day', 'Week', '2 weeks', '3 weeks', '4 weeks', '5 weeks', '6 weeks', '7 weeks', '8 weeks', 'Month', 'Quarter', 'Year']);
  });

  it('turns a stored budget into its choice and back', () => {
    expect(unitOf('weekly', 3)).toBe('weeks-3');
    expect(unitOf('weekly', 1)).toBe('weekly');
    expect(unitOf('monthly', null)).toBe('monthly');
    expect(repeatOfUnit('weeks-3')).toEqual({ frequency: 'weekly', everyWeeks: 3 });
    expect(repeatOfUnit('daily')).toEqual({ frequency: 'daily', everyWeeks: null });
  });
});

describe('the second line on the Budget page', () => {
  const row = (patch: Partial<BudgetRow>): BudgetRow => ({
    id: 'b',
    categoryAccountId: 'c',
    planMinor: 0,
    amountMinor: 0,
    overridden: false,
    frequency: 'monthly',
    amountAsSetMinor: 2_000_000,
    everyWeeks: null,
    startsOn: null,
    share: null,
    ...patch,
  });

  it('says the amount and how it repeats, nothing more', () => {
    expect(repeatLine(row({ frequency: 'weekly', everyWeeks: 1, amountAsSetMinor: 100_000 }), 'IDR')).toBe('100.000 a week');
    expect(repeatLine(row({ frequency: 'daily', amountAsSetMinor: 50_000 }), 'IDR')).toBe('50.000 a day');
    expect(repeatLine(row({ frequency: 'weekly', everyWeeks: 3, startsOn: '2026-11-03', amountAsSetMinor: 1_000_000 }), 'IDR')).toBe('1.000.000 every 3 weeks');
  });

  it('is not there for a month, a quarter, a year, a %, or no budget', () => {
    expect(repeatLine(row({}), 'IDR')).toBeNull();
    expect(repeatLine(row({ frequency: 'quarterly' }), 'IDR')).toBeNull();
    expect(repeatLine(row({ frequency: 'yearly' }), 'IDR')).toBeNull();
    expect(repeatLine(row({ share: { basis: 'take-home', bp: 1000 } }), 'IDR')).toBeNull();
    expect(repeatLine(undefined, 'IDR')).toBeNull();
  });
});
