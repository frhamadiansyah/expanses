import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fifoCosts, type FxMovement } from '../src/index';

/*
 * §6: total cost out + remaining cost = total cost in; no lot is used beyond its amount; the order of entry on the same
 * day does not change the result (ruling R3's two readings). Invented figures: amounts up to ₺5.000, rates 400–700.
 */
const RUNS = 300;
const SEED = 20261015;

const rowArb = fc.record({
  kind: fc.constantFrom('in' as const, 'out' as const),
  day: fc.integer({ min: 1, max: 9 }),
  minor: fc.integer({ min: 1, max: 500_000 }),
  rate: fc.integer({ min: 400, max: 700 }),
  dayOrder: fc.option(fc.integer({ min: 1, max: 5 }), { nil: null }),
  minute: fc.integer({ min: 0, max: 59 }),
});

const movementsArb = fc.array(rowArb, { minLength: 1, maxLength: 25 }).map((rows) =>
  rows.map((row, i): FxMovement => {
    const occurredOn = `2026-11-0${row.day}`;
    const common = { entryId: `e${String(i).padStart(2, '0')}`, occurredOn, dayOrder: row.dayOrder, createdAt: `${occurredOn}T08:${String(row.minute).padStart(2, '0')}:00.000Z`, minor: row.minor };
    const value = Math.round((row.minor * row.rate) / 100);
    return row.kind === 'in' ? { ...common, kind: 'in', costBaseMinor: value } : { ...common, kind: 'out', dayValueBaseMinor: value };
  }),
);

describe('fifoCosts, properties (§6)', () => {
  it('cost out from lots plus cost left equals cost in', () => {
    fc.assert(
      fc.property(movementsArb, (movements) => {
        const result = fifoCosts(movements);
        const costIn = movements.reduce((sum, m) => sum + (m.kind === 'in' ? m.costBaseMinor : 0), 0);
        const fromLots = result.outs.reduce((sum, out) => sum + out.costBaseMinor - out.uncoveredBaseMinor, 0);
        const left = result.open.reduce((sum, lot) => sum + lot.leftCostBaseMinor, 0);
        expect(fromLots + left).toBe(costIn);
      }),
      { numRuns: RUNS, seed: SEED },
    );
  });

  it('never uses a lot beyond its amount, and uses and what is left add up to it', () => {
    fc.assert(
      fc.property(movementsArb, (movements) => {
        const result = fifoCosts(movements);
        for (const inflow of movements.filter((m) => m.kind === 'in')) {
          const used = result.outs.flatMap((out) => out.uses).filter((use) => use.lotId === inflow.entryId).reduce((sum, use) => sum + use.minor, 0);
          const left = result.open.find((lot) => lot.lotId === inflow.entryId)?.leftMinor ?? 0;
          expect(used).toBeLessThanOrEqual(inflow.minor);
          expect(used + left).toBe(inflow.minor);
        }
      }),
      { numRuns: RUNS, seed: SEED },
    );
  });

  it('does not depend on the order the movements are handed in', () => {
    fc.assert(
      fc.property(
        movementsArb.chain((movements) => fc.tuple(fc.constant(movements), fc.shuffledSubarray(movements, { minLength: movements.length, maxLength: movements.length }))),
        ([movements, shuffled]) => {
          expect(fifoCosts(shuffled)).toEqual(fifoCosts(movements));
        },
      ),
      { numRuns: RUNS, seed: SEED },
    );
  });

  it('gives a day the same cost from lots, the same uncovered amount, and leaves the same lots, whatever the order of its money out (R3)', () => {
    fc.assert(
      fc.property(movementsArb, fc.integer({ min: 0, max: 1_000 }), (movements, salt) => {
        // Swap the places (dayOrder, createdAt) of each day's outflows among themselves.
        const reordered = movements.map((m) => ({ ...m }));
        const days = new Set(reordered.map((m) => m.occurredOn));
        for (const day of days) {
          const outs = reordered.filter((m) => m.kind === 'out' && m.occurredOn === day);
          const places = outs.map((m) => ({ dayOrder: m.dayOrder, createdAt: m.createdAt }));
          outs.forEach((m, i) => Object.assign(m, places[(i + salt) % places.length]!));
        }
        const before = fifoCosts(movements);
        const after = fifoCosts(reordered);
        // What lots cost, and how much no lot covered, per day. The uncovered part's value is each line's own (R4: the
        // figure it was posted at), so which line of a day absorbs a shortfall may move its value by the lines' different
        // rates; the lots' cost and the uncovered amount cannot, because the day draws one fixed queue.
        const perDay = (result: ReturnType<typeof fifoCosts>) => {
          const dayOf = new Map(movements.map((m) => [m.entryId, m.occurredOn]));
          const totals: Record<string, { fromLots: number; uncoveredMinor: number }> = {};
          for (const out of result.outs) {
            const day = (totals[dayOf.get(out.entryId)!] ??= { fromLots: 0, uncoveredMinor: 0 });
            day.fromLots += out.costBaseMinor - out.uncoveredBaseMinor;
            day.uncoveredMinor += out.uncoveredMinor;
          }
          return totals;
        };
        expect(perDay(after)).toEqual(perDay(before));
        expect(after.open).toEqual(before.open);
      }),
      { numRuns: RUNS, seed: SEED },
    );
  });
});
