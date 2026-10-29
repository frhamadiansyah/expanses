import { describe, expect, it, vi } from 'vitest';
import { applyTagChanges, fundingSummary, tagChanges, taggedIds } from './goal-tags';

describe('taggedIds', () => {
  it('adds what was tagged in the sheet and drops what was taken away', () => {
    expect(taggedIds(['a', 'b'], ['c', 'a'], ['b'])).toEqual(['a', 'c']);
    expect(taggedIds([], [], [])).toEqual([]);
  });
});

describe('tagChanges', () => {
  it('tags the new and untags the dropped, and nothing for what did not change', () => {
    expect(tagChanges(['a', 'b'], ['b', 'c'])).toEqual({ tag: ['c'], untag: ['a'] });
    expect(tagChanges(['a'], ['a'])).toEqual({ tag: [], untag: [] });
  });
});

describe('applyTagChanges', () => {
  it('retags each buy to the new goal, and untags the dropped ones to no goal', async () => {
    const retag = vi.fn(async () => {});
    const result = await applyTagChanges(retag, 'goal-1', { tag: ['t1', 't2'], untag: ['t0'] });
    expect(result.failed).toEqual([]);
    expect(retag.mock.calls).toEqual([
      ['t0', null],
      ['t1', 'goal-1'],
      ['t2', 'goal-1'],
    ]);
  });
  it('reports a refused buy and still applies the others', async () => {
    const retag = vi.fn(async (tradeId: string) => {
      if (tradeId === 't1') throw new Error('Units from this purchase were already sold from its goal, so it cannot move');
    });
    const result = await applyTagChanges(retag, 'goal-1', { tag: ['t1', 't2'], untag: [] });
    expect(result.failed).toEqual([{ tradeId: 't1', message: 'Units from this purchase were already sold from its goal, so it cannot move' }]);
    expect(retag).toHaveBeenCalledTimes(2);
  });
});

describe('fundingSummary', () => {
  it('joins the money set aside and the purchases tagged', () => {
    expect(fundingSummary('None', 0)).toBe('None');
    expect(fundingSummary('Rp 5.000.000', 0)).toBe('Rp 5.000.000');
    expect(fundingSummary('None', 1)).toBe('1 purchase');
    expect(fundingSummary('Rp 5.000.000', 1)).toBe('Rp 5.000.000 + 1 purchase');
    expect(fundingSummary('Rp 5.000.000', 3)).toBe('Rp 5.000.000 + 3 purchases');
  });
});
