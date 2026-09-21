import { describe, expect, it } from 'vitest';
import { fundingOrder, type Goal, goalClass } from '../src/index';

export const goal = (id: string, kind: Goal['kind'], rank: number): Goal => ({
  id, name: id, kind, rank, growthBps: 0, returnBps: 0, standingMonthlyMinor: 0, standingNote: null, stages: [],
});

describe('compulsory and additional', () => {
  it('names only the emergency fund and retirement compulsory', () => {
    expect(goalClass('emergency')).toBe('compulsory');
    expect(goalClass('retirement')).toBe('compulsory');
    for (const kind of ['education', 'hajj', 'umrah', 'home', 'wedding', 'vehicle', 'holiday', 'other'] as const) {
      expect(goalClass(kind)).toBe('additional');
    }
  });

  it('orders compulsory goals first, each class by its own rank', () => {
    const goals = [goal('holiday', 'holiday', 0), goal('retire', 'retirement', 3), goal('hajj', 'hajj', 1), goal('rainy', 'emergency', 2)];
    expect(fundingOrder(goals).map((row) => row.id)).toEqual(['rainy', 'retire', 'holiday', 'hajj']);
  });
});
