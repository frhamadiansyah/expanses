import { formatMinor } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { weekdayDayMonth, weeklyDueWords, weeklyHeroLine, weeksWords } from './bill-view';

// Invented: Rp 1.000.000 every 3 weeks, next due Tue 15 Dec 2026.
describe('a bill by weeks on its page', () => {
  it('names a date with its weekday', () => {
    expect(weekdayDayMonth('2026-12-15')).toBe('Tue, 15 Dec');
    expect(weekdayDayMonth('2027-01-05')).toBe('Tue, 5 Jan');
  });

  it('says how far the next one is', () => {
    expect(weeklyDueWords('2026-12-15', '2026-11-25')).toEqual({ text: 'Due · in 20 days', tone: 'ink-3' });
    expect(weeklyDueWords('2026-11-27', '2026-11-25')).toEqual({ text: 'Due · in 2 days', tone: 'warn' });
    expect(weeklyDueWords('2026-11-25', '2026-11-25')).toEqual({ text: 'Due today', tone: 'warn' });
    expect(weeklyDueWords('2026-11-24', '2026-11-25')).toEqual({ text: 'Overdue · 1 day', tone: 'alarm' });
  });

  it('gives what it comes to a month and the next date under the amount', () => {
    const money = (minor: number) => formatMinor(minor, 'IDR');
    expect(weeklyHeroLine(100_000_000, 3, '2026-12-15', money, '2026-11-25')).toBe(`≈ ${formatMinor(144_800_000, 'IDR')} a month · next 15 Dec`);
    expect(weeklyHeroLine(null, 3, '2026-12-15', money, '2026-11-25')).toBe('Amount varies · next 15 Dec');
    expect(weeklyHeroLine(100_000_000, 3, '2026-11-03', money, '2026-11-25')).toBe(`≈ ${formatMinor(144_800_000, 'IDR')} a month · overdue since 3 Nov`);
    expect(weeksWords(1)).toBe('1 week');
    expect(weeksWords(3)).toBe('3 weeks');
  });
});
