import { describe, expect, it } from 'vitest';
import { landed, movedBy } from './DayReorder';

describe('movedBy', () => {
  it('moves a row one place up or down its day', () => {
    expect(movedBy(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b']);
    expect(movedBy(['a', 'b', 'c'], 'a', 1)).toEqual(['b', 'a', 'c']);
  });

  it('goes nowhere past either end, or for a row not in the day', () => {
    expect(movedBy(['a', 'b'], 'a', -1)).toBeNull();
    expect(movedBy(['a', 'b'], 'b', 1)).toBeNull();
    expect(movedBy(['a', 'b'], 'x', 1)).toBeNull();
  });
});

describe('landed', () => {
  it('clears a day once its own drop has been written', () => {
    const order = ['b', 'a'];
    expect(landed({ '2026-10-14': order, '2026-10-13': ['x'] }, '2026-10-14', order)).toEqual({ '2026-10-13': ['x'] });
  });

  it('keeps a second drop on the same day that came while the first was writing', () => {
    const first = ['b', 'a', 'c'];
    const second = ['c', 'b', 'a'];
    expect(landed({ '2026-10-14': second }, '2026-10-14', first)).toEqual({ '2026-10-14': second });
  });
});
