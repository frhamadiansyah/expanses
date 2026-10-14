import { describe, expect, it } from 'vitest';
import { compareWithinDay, planDayOrder } from '../src/index';

const at = (n: number) => `2026-10-14T10:00:0${n}.000Z`;

describe('compareWithinDay', () => {
  it('puts rows never placed first, newest first, then placed rows by their position', () => {
    const rows = [
      { id: 'placed-2', dayOrder: 2, createdAt: at(1) },
      { id: 'old', dayOrder: null, createdAt: at(2) },
      { id: 'placed-1', dayOrder: 1, createdAt: at(3) },
      { id: 'new', dayOrder: null, createdAt: at(4) },
      { id: 'placed-1.5', dayOrder: 1.5, createdAt: at(0) },
    ];
    expect([...rows].sort(compareWithinDay).map((r) => r.id)).toEqual(['new', 'old', 'placed-1', 'placed-1.5', 'placed-2']);
  });

  it('reads a missing position as none, and two equal positions newest first', () => {
    expect([{ id: 'a', dayOrder: 1, createdAt: at(1) }, { id: 'b', createdAt: at(0) }, { id: 'c', dayOrder: 1, createdAt: at(2) }].sort(compareWithinDay).map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('planDayOrder', () => {
  it('writes the moved row alone, halfway between two placed neighbours', () => {
    const rows = [
      { id: 'a', dayOrder: 1 },
      { id: 'moved', dayOrder: 3 },
      { id: 'b', dayOrder: 2 },
    ];
    expect(planDayOrder(rows, 'moved')).toEqual([{ id: 'moved', dayOrder: 1.5 }]);
  });

  it('goes one below the first placed row when moved to the top, one past the last at the bottom', () => {
    expect(planDayOrder([{ id: 'moved', dayOrder: 2 }, { id: 'a', dayOrder: 1 }], 'moved')).toEqual([{ id: 'moved', dayOrder: 0 }]);
    expect(planDayOrder([{ id: 'a', dayOrder: 2 }, { id: 'moved', dayOrder: 1 }], 'moved')).toEqual([{ id: 'moved', dayOrder: 3 }]);
  });

  it('numbers the whole day once when a neighbour has no position yet, writing only what changes', () => {
    const rows = [
      { id: 'c', dayOrder: null },
      { id: 'a', dayOrder: null },
      { id: 'b', dayOrder: null },
    ];
    expect(planDayOrder(rows, 'c')).toEqual([
      { id: 'c', dayOrder: 1 },
      { id: 'a', dayOrder: 2 },
      { id: 'b', dayOrder: 3 },
    ]);
    // A new row dragged between two placed ones takes the gap between them; dragged among unplaced ones, the day is numbered.
    expect(planDayOrder([{ id: 'p1', dayOrder: 1 }, { id: 'n', dayOrder: null }, { id: 'p2', dayOrder: 2 }], 'n')).toEqual([{ id: 'n', dayOrder: 1.5 }]);
    expect(planDayOrder([{ id: 'n2', dayOrder: null }, { id: 'n1', dayOrder: null }, { id: 'p1', dayOrder: 1 }, { id: 'p2', dayOrder: 2 }], 'n1')).toEqual([
      { id: 'n2', dayOrder: 1 },
      { id: 'n1', dayOrder: 2 },
      { id: 'p1', dayOrder: 3 },
      { id: 'p2', dayOrder: 4 },
    ]);
  });

  it('writes nothing for a row already where it was dropped, or a day of one', () => {
    expect(planDayOrder([{ id: 'a', dayOrder: 1 }, { id: 'moved', dayOrder: 2 }, { id: 'b', dayOrder: 3 }], 'moved')).toEqual([]);
    expect(planDayOrder([{ id: 'moved', dayOrder: null }], 'moved')).toEqual([]);
  });

  it('numbers the day again when the gap between two neighbours has run out', () => {
    const tight = 1 + Number.EPSILON;
    expect(planDayOrder([{ id: 'a', dayOrder: 1 }, { id: 'moved', dayOrder: 5 }, { id: 'b', dayOrder: tight }], 'moved')).toEqual([
      { id: 'moved', dayOrder: 2 },
      { id: 'b', dayOrder: 3 },
    ]);
  });

  it('refuses a row that is not in the day it is placed in', () => {
    expect(() => planDayOrder([{ id: 'a', dayOrder: 1 }], 'moved')).toThrow();
  });
});
