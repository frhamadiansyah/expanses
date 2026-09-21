import { describe, expect, it } from 'vitest';
import { movedOrder } from './goal-moves';

// Page order, as `fundingOrder` hands it: compulsory first, then additional.
const ordered = [
  { goalId: 'ef', kind: 'emergency' as const },
  { goalId: 'retire', kind: 'retirement' as const },
  { goalId: 'holiday', kind: 'holiday' as const },
  { goalId: 'car', kind: 'vehicle' as const },
];

describe('moving a goal on the Goals page', () => {
  it('moves within a section', () => {
    expect(movedOrder(ordered, 'ef', 1)).toEqual(['retire', 'ef', 'holiday', 'car']);
    expect(movedOrder(ordered, 'car', -1)).toEqual(['ef', 'retire', 'car', 'holiday']);
  });

  it('never ranks a compulsory goal below an additional one, nor lifts an additional one above it', () => {
    expect(movedOrder(ordered, 'retire', 1)).toBeNull();
    expect(movedOrder(ordered, 'holiday', -1)).toBeNull();
  });

  it('does nothing past either end', () => {
    expect(movedOrder(ordered, 'ef', -1)).toBeNull();
    expect(movedOrder(ordered, 'car', 1)).toBeNull();
    expect(movedOrder(ordered, 'gone', 1)).toBeNull();
  });
});
