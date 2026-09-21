import { describe, expect, it } from 'vitest';
import { perMonthMinor } from '../src/index';

describe('a budget line in a month', () => {
  it('turns a week into 52/12 of it — not four of it, and rounded, not floored', () => {
    // 500.000 × 52 ÷ 12 = 2.166.666,67. ×4 would say 2.000.000; a floor would say 2.166.666.
    expect(perMonthMinor(500_000, 'weekly')).toBe(2_166_667);
  });

  it('turns a day into 365/12 of it — not thirty of it', () => {
    // 50.000 × 365 ÷ 12 = 1.520.833,33. ×30 would say 1.500.000.
    expect(perMonthMinor(50_000, 'daily')).toBe(1_520_833);
  });

  it('rounds a half away from zero', () => {
    // 6 × 365 ÷ 12 = 182,5 exactly: a floor says 182.
    expect(perMonthMinor(6, 'daily')).toBe(183);
  });

  it('divides a quarter by three and a year by twelve, rounding what does not divide', () => {
    // 15.386.000 ÷ 3 = 5.128.666,67 and 2.400.010 ÷ 12 = 200.000,83: a floor says 5.128.666 and 200.000.
    // (2.400.000 ÷ 12 divides evenly, so it could not tell a floor from a round.)
    expect(perMonthMinor(15_386_000, 'quarterly')).toBe(5_128_667);
    expect(perMonthMinor(2_400_010, 'yearly')).toBe(200_001);
    expect(perMonthMinor(900_000, 'monthly')).toBe(900_000);
  });

  it('works in cents: US$10,00 a week is US$43,33 a month', () => {
    expect(perMonthMinor(1_000, 'weekly')).toBe(4_333);
    expect(perMonthMinor(1_250, 'daily')).toBe(38_021);
  });

  it('adds converted figures, never typed ones', () => {
    const lines = [
      perMonthMinor(500_000, 'weekly'),
      perMonthMinor(50_000, 'daily'),
      perMonthMinor(900_000, 'monthly'),
      perMonthMinor(450_000, 'monthly'),
      perMonthMinor(2_400_000, 'yearly'),
      perMonthMinor(15_386_000, 'quarterly'),
    ];
    expect(lines.reduce((total, line) => total + line, 0)).toBe(10_366_167);
  });

  it('comes to nothing for a tiny yearly figure, which the repository then refuses', () => {
    expect(perMonthMinor(5, 'yearly')).toBe(0);
  });

  it('refuses an amount that is not a whole number of minor units', () => {
    expect(() => perMonthMinor(10.5, 'weekly')).toThrow(RangeError);
  });
});
