import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { cardBar, splitPeriod, type PeriodMovement } from '../src/net-worth/summary';

const movement: fc.Arbitrary<PeriodMovement> = fc.record({
  transactionId: fc.string({ minLength: 1, maxLength: 8 }),
  amountMinor: fc.integer({ min: -5_000_000_000, max: 5_000_000_000 }),
  household: fc.boolean(),
  transfer: fc.boolean(),
  transferId: fc.constantFrom('mt-a', 'mt-b', 'mt-c'),
});

describe('splitPeriod property', () => {
  it('opening + household + other + transfer always equals closing, and a transfer is never other use', () => {
    fc.assert(
      fc.property(fc.integer({ min: -5_000_000_000, max: 5_000_000_000 }), fc.array(movement, { maxLength: 30 }), (opening, movements) => {
        const r = splitPeriod(opening, movements);
        expect(opening + r.householdMinor + r.otherUseMinor + r.transferMinor).toBe(r.closingMinor);
        const sum = (keep: (m: PeriodMovement) => boolean) => movements.filter(keep).reduce((t, m) => t + m.amountMinor, 0);
        expect(r.transferMinor).toBe(sum((m) => m.transfer === true));
        expect(r.householdMinor).toBe(sum((m) => m.transfer !== true && m.household));
        // The ids it counted add up to the part, one entry each, and each is that transfer's own movements.
        expect(r.transfers.reduce((t, x) => t + x.minor, 0)).toBe(r.transferMinor);
        expect(new Set(r.transfers.map((x) => x.transferId)).size).toBe(r.transfers.length);
        for (const x of r.transfers) expect(x.minor).toBe(sum((m) => m.transfer === true && m.transferId === x.transferId));
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
        fc.integer({ min: 0, max: 10_000_000_000 }),
        (limitMinor, openingMinor, householdMinor, otherUseMinor, transferMinor) => {
          const balanceMinor = openingMinor + householdMinor + otherUseMinor + transferMinor;
          fc.pre(balanceMinor <= limitMinor);
          const bar = cardBar(limitMinor, { openingMinor, householdMinor, otherUseMinor, transferMinor, balanceMinor });
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
        fc.integer({ min: -5_000_000_000, max: 5_000_000_000 }),
        (limitMinor, openingMinor, householdMinor, otherUseMinor, transferMinor, balanceMinor) => {
          const bar = cardBar(limitMinor, { openingMinor, householdMinor, otherUseMinor, transferMinor, balanceMinor });
          expect(bar.householdPct).toBeGreaterThanOrEqual(0);
          expect(bar.householdPct).toBeLessThanOrEqual(100);
          expect(bar.otherPct).toBeGreaterThanOrEqual(0);
          expect(bar.otherPct).toBeLessThanOrEqual(100);
        },
      ),
    );
  });
});
