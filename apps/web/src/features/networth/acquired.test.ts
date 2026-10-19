import { describe, expect, it } from 'vitest';
import { acquiredLabel, acquiredOn, daysIn, NO_DATE, partsOf } from './acquired';

const TODAY = '2026-10-19';

describe('acquiredOn', () => {
  it('fills a year alone with 1 January', () => {
    expect(acquiredOn({ year: '2021', month: '', day: '' }, TODAY)).toEqual({ on: '2021-01-01', precision: 'year' });
  });

  it('fills a month with its 1st', () => {
    expect(acquiredOn({ year: '2021', month: '3', day: '' }, TODAY)).toEqual({ on: '2021-03-01', precision: 'month' });
  });

  it('keeps a whole day as typed', () => {
    expect(acquiredOn({ year: '2021', month: '3', day: '14' }, TODAY)).toEqual({ on: '2021-03-14', precision: 'day' });
  });

  it('takes this year and this month, which start on or before today', () => {
    expect(acquiredOn({ year: '2026', month: '', day: '' }, TODAY)).toEqual({ on: '2026-01-01', precision: 'year' });
    expect(() => acquiredOn(NO_DATE, TODAY)).toThrow('Say the year it was acquired');
    expect(acquiredOn({ year: '2026', month: '10', day: '' }, TODAY)).toEqual({ on: '2026-10-01', precision: 'month' });
    expect(acquiredOn({ year: '2026', month: '10', day: '19' }, TODAY).on).toBe('2026-10-19');
  });

  it('says what is wrong, in plain words', () => {
    expect(() => acquiredOn({ year: '', month: '', day: '' }, TODAY)).toThrow('Say the year it was acquired');
    expect(() => acquiredOn({ year: '21', month: '', day: '' }, TODAY)).toThrow('Say the year it was acquired');
    expect(() => acquiredOn({ year: '1850', month: '', day: '' }, TODAY)).toThrow(/too early/);
    expect(() => acquiredOn({ year: '2027', month: '', day: '' }, TODAY)).toThrow(/after today/);
    expect(() => acquiredOn({ year: '2026', month: '11', day: '' }, TODAY)).toThrow(/after today/);
    expect(() => acquiredOn({ year: '2026', month: '10', day: '20' }, TODAY)).toThrow(/after today/);
    expect(() => acquiredOn({ year: '2023', month: '2', day: '29' }, TODAY)).toThrow(/does not exist/);
    expect(() => acquiredOn({ year: '2023', month: '', day: '5' }, TODAY)).toThrow(/month before the day/);
  });

  it('counts February for the year typed', () => {
    expect(daysIn('2024', '2')).toBe(29);
    expect(daysIn('2023', '2')).toBe(28);
    expect(daysIn('', '')).toBe(31);
    expect(acquiredOn({ year: '2024', month: '2', day: '29' }, TODAY).on).toBe('2024-02-29');
  });
});

describe('reading it back', () => {
  it('shows only what was typed', () => {
    expect(acquiredLabel('2021-01-01', 'year')).toBe('2021');
    expect(acquiredLabel('2021-03-01', 'month')).toBe('Mar 2021');
    expect(acquiredLabel('2021-03-14', 'day')).toBe('14 Mar 2021');
  });

  it('round-trips through the parts the Edit screen starts from', () => {
    for (const parts of [
      { year: '2021', month: '', day: '' },
      { year: '2021', month: '3', day: '' },
      { year: '2021', month: '3', day: '14' },
    ]) {
      const { on, precision } = acquiredOn(parts, TODAY);
      expect(partsOf(on, precision)).toEqual(parts);
    }
  });
});
