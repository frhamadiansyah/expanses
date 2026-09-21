import { describe, expect, it } from 'vitest';
import { emergencyMonthsFor, HOUSEHOLDS, INCOME_STABILITIES } from '../src/index';

describe('emergency months from two answers', () => {
  it.each([
    ['single', 'salaried', 3],
    ['single', 'irregular', 6],
    ['couple', 'salaried', 6],
    ['couple', 'irregular', 12],
    ['children', 'salaried', 12],
    ['children', 'irregular', 24],
  ] as const)('%s and %s is %i months', (household, income, months) => {
    expect(emergencyMonthsFor(household, income)).toBe(months);
  });

  it('is exactly twice as many for irregular income, in every household', () => {
    for (const household of HOUSEHOLDS) {
      expect(emergencyMonthsFor(household, 'irregular')).toBe(2 * emergencyMonthsFor(household, 'salaried'));
    }
    expect(INCOME_STABILITIES).toEqual(['salaried', 'irregular']);
  });
});
