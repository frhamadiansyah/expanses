import { describe, expect, it } from 'vitest';
import { fitByRank, fundingOrder, type Goal, goalClass, type GoalPlan } from '../src/index';

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

const planOf = (goalId: string, requiredMonthlyMinor: number) => ({ goalId, requiredMonthlyMinor }) as GoalPlan;

describe('fitByRank', () => {
  it('fills an emergency fund before a holiday ranked above it', () => {
    const goals = [goal('holiday', 'holiday', 0), goal('rainy', 'emergency', 1)];
    const fits = fitByRank([planOf('holiday', 3_000_000), planOf('rainy', 4_000_000)], goals, 5_000_000);
    // By rank alone the holiday would take 3 jt and leave the emergency fund 2 jt, only partly funded.
    expect(fits).toEqual([
      { goalId: 'rainy', fundedMonthlyMinor: 4_000_000, fits: 'full' },
      { goalId: 'holiday', fundedMonthlyMinor: 1_000_000, fits: 'partial' },
    ]);
  });
});
