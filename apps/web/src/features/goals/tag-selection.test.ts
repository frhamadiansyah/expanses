import { describe, expect, it } from 'vitest';
import { allTicked, askAboutMoves, toggleAll, toggleOne } from './tag-selection';

describe('toggleOne', () => {
  it('ticks an unticked buy and unticks a ticked one, keeping the list order of the rest', () => {
    expect(toggleOne(['a', 'b'], 'c')).toEqual(['a', 'b', 'c']);
    expect(toggleOne(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
  });
});

describe('toggleAll', () => {
  it('ticks every buy when some are open, and clears them when all are ticked', () => {
    expect(toggleAll(['a', 'b', 'c'], ['b'])).toEqual(['a', 'b', 'c']);
    expect(toggleAll(['a', 'b', 'c'], ['a', 'b', 'c'])).toEqual([]);
    expect(toggleAll([], [])).toEqual([]);
  });
  it('allTicked is false for an empty list', () => {
    expect(allTicked(['a'], ['a'])).toBe(true);
    expect(allTicked(['a', 'b'], ['a'])).toBe(false);
    expect(allTicked([], [])).toBe(false);
  });
});

describe('askAboutMoves', () => {
  const buys = [
    { id: 't1', goalId: null },
    { id: 't2', goalId: 'g-other' },
    { id: 't3', goalId: 'g-other' },
    { id: 't4', goalId: 'g-third' },
    { id: 't5', goalId: 'g-here' },
    { id: 't6', goalId: 'g-x', goalParts: [{}] },
  ];
  const nameOf = (id: string | null) => ({ 'g-other': 'Umrah', 'g-third': 'School' })[id ?? ''] ?? 'Goal';
  it('counts only the ticked buys that serve another goal, naming each goal once', () => {
    expect(askAboutMoves(buys, ['t1', 't2', 't3', 't4', 't5'], 'g-here', nameOf)).toEqual({ count: 3, goals: ['Umrah', 'School'] });
  });
  it('names a split buy as several goals', () => {
    expect(askAboutMoves(buys, ['t6'], 'g-here', nameOf)).toEqual({ count: 1, goals: ['Several goals'] });
  });
  it('asks nothing when no ticked buy serves another goal', () => {
    expect(askAboutMoves(buys, ['t1', 't5'], 'g-here', nameOf)).toEqual({ count: 0, goals: [] });
    expect(askAboutMoves(buys, [], 'g-here', nameOf).count).toBe(0);
  });
  it('treats a new goal (no id yet) as every tagged buy being elsewhere', () => {
    expect(askAboutMoves(buys, ['t1', 't2'], undefined, nameOf)).toEqual({ count: 1, goals: ['Umrah'] });
  });
});
