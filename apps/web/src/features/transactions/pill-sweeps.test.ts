import { describe, expect, it } from 'vitest';
import { pillSweeps } from './Donut';

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

describe('pillSweeps', () => {
  it('leaves shares alone when every slice is already long enough', () => {
    const sweeps = pillSweeps([0.5, 0.3, 0.2], 6, 0.3);
    [3, 1.8, 1.2].forEach((expected, index) => expect(sweeps[index]).toBeCloseTo(expected));
  });

  it('lifts a tiny share to the shortest pill and takes the room from the others', () => {
    const sweeps = pillSweeps([0.9, 0.09, 0.01], 6, 0.3);
    expect(sweeps[2]).toBe(0.3);
    expect(sum(sweeps)).toBeCloseTo(6);
    // The others keep their proportion to each other.
    expect(sweeps[0]! / sweeps[1]!).toBeCloseTo(10);
  });

  it('settles when lifting one slice pushes another under the floor', () => {
    const sweeps = pillSweeps([0.9, 0.052, 0.048], 6, 0.3);
    expect(sweeps.every((sweep) => sweep >= 0.3 - 1e-9)).toBe(true);
    expect(sum(sweeps)).toBeCloseTo(6);
  });

  it('draws nothing for a month with nothing in it', () => {
    expect(pillSweeps([0, 0], 6, 0.3)).toEqual([0, 0]);
  });
});
