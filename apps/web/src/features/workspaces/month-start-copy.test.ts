import { describe, expect, it } from 'vitest';
import { MONTH_START_LAST } from '@expanses/core';
import { monthStartFooter, monthStartLines } from './MonthStartPage';

describe('Month starts on, in words', () => {
  it('names this month by its dates under the row', () => {
    expect(monthStartFooter(25, '2026-11-16')).toBe('November is 25 Oct – 24 Nov. Cashflow, Budget, bills and reports all use it.');
    expect(monthStartFooter(1, '2026-11-16')).toBe('November is 1 Nov – 30 Nov. Cashflow, Budget, bills and reports all use it.');
  });

  it('shows this month and the next on the picker', () => {
    expect(monthStartLines(25, '2026-11-16')).toEqual(['November = 25 Oct – 24 Nov', 'December = 25 Nov – 24 Dec']);
    expect(monthStartLines(MONTH_START_LAST, '2026-11-16')).toEqual(['November = 31 Oct – 29 Nov', 'December = 30 Nov – 30 Dec']);
  });

  it('says nothing to anyone: no "you" or "your"', () => {
    for (const text of [monthStartFooter(25, '2026-11-16'), ...monthStartLines(25, '2026-11-16')]) expect(text).not.toMatch(/\byou(r)?\b/i);
  });
});
