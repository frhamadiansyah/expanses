import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { cardBar, splitPeriod, type PeriodMovement } from '../src/net-worth/summary';

const movement: fc.Arbitrary<PeriodMovement> = fc.record({
  transactionId: fc.string({ minLength: 1, maxLength: 8 }),
  amountMinor: fc.integer({ min: -5_000_000_000, max: 5_000_000_000 }),
  household: fc.boolean(),
});

describe('splitPeriod property', () => {
  it('opening + household + other always equals closing', () => {
    fc.assert(
      fc.property(fc.integer({ min: -5_000_000_000, max: 5_000_000_000 }), fc.array(movement, { maxLength: 30 }), (opening, movements) => {
        const r = splitPeriod(opening, movements);
        expect(opening + r.householdMinor + r.otherUseMinor).toBe(r.closingMinor);
      }),
    );
  });
});

describe('cardBar property', () => {
  it('percentages stay within [0, 100] and sum to at most 100 when balance is within limit and both parts are non-negative', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000_000_000 }),
        fc.integer({ min: 0, max: 10_000_000_000 }),
        fc.integer({ min: 0, max: 10_000_000_000 }),
        fc.integer({ min: 0, max: 10_000_000_000 }),
        (limitMinor, openingMinor, householdMinor, otherUseMinor) => {
          const balanceMinor = openingMinor + householdMinor + otherUseMinor;
          fc.pre(balanceMinor <= limitMinor);
          const bar = cardBar(limitMinor, { openingMinor, householdMinor, otherUseMinor, balanceMinor });
          expect(bar.householdPct).toBeGreaterThanOrEqual(0);
          expect(bar.householdPct).toBeLessThanOrEqual(100);
          expect(bar.otherPct).toBeGreaterThanOrEqual(0);
          expect(bar.otherPct).toBeLessThanOrEqual(100);
          expect(bar.householdPct + bar.otherPct).toBeLessThanOrEqual(100);
        },
      ),
    );
  });

  it('percentages always stay within [0, 100] regardless of inputs', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000_000, max: 10_000_000_000 }),
        fc.integer({ min: -5_000_000_000, max: 5_000_000_000 }),
        fc.integer({ min: -5_000_000_000, max: 5_000_000_000 }),
        fc.integer({ min: -5_000_000_000, max: 5_000_000_000 }),
        fc.integer({ min: -5_000_000_000, max: 5_000_000_000 }),
        (limitMinor, openingMinor, householdMinor, otherUseMinor, balanceMinor) => {
          const bar = cardBar(limitMinor, { openingMinor, householdMinor, otherUseMinor, balanceMinor });
          expect(bar.householdPct).toBeGreaterThanOrEqual(0);
          expect(bar.householdPct).toBeLessThanOrEqual(100);
          expect(bar.otherPct).toBeGreaterThanOrEqual(0);
          expect(bar.otherPct).toBeLessThanOrEqual(100);
        },
      ),
    );
  });
});
