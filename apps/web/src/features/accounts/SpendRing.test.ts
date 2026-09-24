import { describe, expect, it } from 'vitest';
import { ringSweeps } from './SpendRing';

/*
 * The ring the Accounts tile divides its money into. Only the arithmetic is here: the drawing is strokes on a
 * circle, and what it has to get right is that the shares are proportional, the gaps are paid for before they are
 * measured, and a share of nothing is drawn as nothing.
 */
describe('the tile’s ring', () => {
  it('gives each share its own proportion of the circle, with the gaps taken out first', () => {
    const sweeps = ringSweeps([75, 25], 0.04);
    expect(sweeps).toHaveLength(2);
    expect(sweeps[0]! + sweeps[1]!).toBeCloseTo(1 - 0.08, 10);
    expect(sweeps[0]! / sweeps[1]!).toBeCloseTo(3, 10);
  });

  it('draws nothing for a share of nothing, and does not charge that share a gap', () => {
    const sweeps = ringSweeps([100, 0], 0.04);
    expect(sweeps[1]).toBe(0);
    expect(sweeps[0]!).toBeCloseTo(0.96, 10);
  });

  it('draws nothing at all when there is nothing to divide', () => {
    expect(ringSweeps([0, 0])).toEqual([0, 0]);
  });

  it('takes a share that is owed more than it holds as nothing, leaving the ring closed', () => {
    const sweeps = ringSweeps([-50, 50]);
    expect(sweeps[0]).toBe(0);
    expect(sweeps[1]!).toBeCloseTo(0.96, 10);
  });
});
