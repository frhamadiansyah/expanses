import { describe, expect, it } from 'vitest';
import { type DueFee, withWaivedYears } from './fee-due';

const card: DueFee = { cardId: 'c1', name: 'Sample card', currency: 'IDR', annualFeeMinor: 450_000, annualFeeOn: '2025-11-20', annualFeeWaivedYear: null };

/* Recurring reads a fee year the way the Fee waiver page does: a reversal a statement check found waives it too. */
describe('a fee year the page reads as waived', () => {
  it('reads as waived, so it is not due', () => {
    expect(withWaivedYears([card], new Map([['c1', 2026]]))[0]!.annualFeeWaivedYear).toBe(2026);
  });
  it('leaves a card the page does not read as waived as it was', () => {
    expect(withWaivedYears([card], new Map([['c2', 2026]]))[0]).toBe(card);
    expect(withWaivedYears([card], new Map())[0]).toBe(card);
  });
});
