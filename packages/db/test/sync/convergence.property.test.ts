import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Household, projectBook } from './household';
import { play, programArb } from './programs';

/*
 * Spec §13 `convergence`: N devices (2–3), random local programs — post, correct, void, budgets and overrides, bills
 * and skips, categories and needs, the book's income and name — with offline stretches (a device syncs only when its
 * program says so) and random interleavings through `MemoryTransport`. The owner records history before sharing, so
 * the book is seeded (§6.5) before the others join, and each joiner arrives at a random point. Once everyone has
 * synced, every `SHARED_ENTITIES` projection is identical on every device. Seeded, so a failure names its seed.
 */
const RUNS = Number(process.env.CONVERGENCE_RUNS ?? 200);

describe('convergence', () => {
  it(`every device reads the same book after ${RUNS} random programs`, async () => {
    await fc.assert(
      fc.asyncProperty(programArb({ maxSteps: 24, maxHistory: 6 }), async (program) => {
        const home = new Household();
        const devices = await play(home, program);
        const [first, ...rest] = await Promise.all(devices.map((d) => projectBook(d.database, home.bookId)));
        for (const other of rest) expect(other).toEqual(first);
      }),
      { numRuns: RUNS, seed: 20260927, endOnFailure: true },
    );
  }, 900_000);
});
