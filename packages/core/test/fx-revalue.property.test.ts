import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type FxLine, revalueTransaction, spreadBase } from '../src/index';

/* Review Focus 4: a cost shared over a split always adds up to the money line's, and every currency balances in base. */
const RUNS = 300;
const SEED = 20261015;
const dayValue = (minor: number, rate: number) => Math.round((minor * rate) / 100);

describe('revalueTransaction, properties', () => {
  it('shares a cost over any split so the categories add up to it exactly', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 1_000_000 }), { minLength: 1, maxLength: 6 }),
        fc.integer({ min: 400, max: 700 }),
        fc.integer({ min: 1, max: 900_000_000 }),
        (amounts, rate, cost) => {
          const total = amounts.reduce((a, b) => a + b, 0);
          const categories = amounts.map((amount, i): FxLine => ({ entryId: `c${i}`, currency: 'TRY', amountMinor: amount, amountBaseMinor: dayValue(amount, rate), role: 'other' }));
          const money: FxLine = { entryId: 'm', currency: 'TRY', amountMinor: -total, amountBaseMinor: -categories.reduce((s, l) => s + l.amountBaseMinor, 0), role: 'lot' };
          const { bases, gainLossBaseMinor } = revalueTransaction({ lines: [money, ...categories], baseCurrency: 'IDR', outCosts: { m: cost } });
          expect(categories.reduce((s, l) => s + bases[l.entryId]!, 0)).toBe(cost);
          expect(bases.m).toBe(-cost);
          expect(gainLossBaseMinor).toBe(0);
        },
      ),
      { numRuns: RUNS, seed: SEED },
    );
  });

  it('changing back into the base currency books exactly what arrived less the cost, and the foreign side balances', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), fc.integer({ min: 1, max: 900_000_000 }), fc.integer({ min: 1, max: 900_000_000 }), (minor, received, cost) => {
        const stored = dayValue(minor, 512);
        const lines: FxLine[] = [
          { entryId: 'p', currency: 'TRY', amountMinor: -minor, amountBaseMinor: -stored, role: 'lot' },
          { entryId: 'x1', currency: 'TRY', amountMinor: minor, amountBaseMinor: stored, role: 'exchange' },
          { entryId: 'bank', currency: 'IDR', amountMinor: received, amountBaseMinor: received, role: 'money' },
          { entryId: 'x2', currency: 'IDR', amountMinor: -received, amountBaseMinor: -received, role: 'exchange' },
        ];
        const { bases, gainLossBaseMinor } = revalueTransaction({ lines, baseCurrency: 'IDR', outCosts: { p: cost } });
        expect(gainLossBaseMinor).toBe(received - cost);
        expect(bases.p! + bases.x1!).toBe(0);
        expect(bases.bank).toBe(received);
      }),
      { numRuns: RUNS, seed: SEED },
    );
  });

  it('spreadBase always adds up to the total', () => {
    fc.assert(
      fc.property(fc.integer({ min: -900_000_000, max: 900_000_000 }), fc.array(fc.integer({ min: -1_000_000, max: 1_000_000 }), { minLength: 1, maxLength: 8 }), (total, weights) => {
        expect(spreadBase(total, weights).reduce((a, b) => a + b, 0)).toBe(total);
      }),
      { numRuns: RUNS, seed: SEED },
    );
  });
});
