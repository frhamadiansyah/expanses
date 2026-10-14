import { describe, expect, it } from 'vitest';
import { movedBy } from './DayReorder';

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
