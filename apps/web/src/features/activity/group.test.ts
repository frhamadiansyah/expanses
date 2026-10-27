import type { ActivityLine } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { dayHeader, groupByDay, localDay, stateWords } from './group';

const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).toISOString();
const line = (id: string, when: string): ActivityLine => ({
  id,
  at: when,
  kind: 'edit',
  group: 'transactions',
  title: id,
  subtitle: '',
  who: null,
  changes: [],
  state: 'open',
  undo: null,
  transactionId: null,
});

describe('the Activity page grouping', () => {
  const now = new Date(2026, 9, 27, 14, 0);

  it('puts today, yesterday and older days under their own headers, in the order given', () => {
    const groups = groupByDay([line('a', at(2026, 10, 27, 12, 30)), line('b', at(2026, 10, 27, 9)), line('c', at(2026, 10, 26, 20, 15)), line('d', at(2026, 10, 3))], now);
    expect(groups.map((g) => [g.header, g.lines.map((l) => l.id)])).toEqual([
      ['Today', ['a', 'b']],
      ['Yesterday', ['c']],
      ['3 October 2026', ['d']],
    ]);
  });

  it('reads a day across a month boundary as yesterday', () => {
    expect(dayHeader(localDay(at(2026, 9, 30)), new Date(2026, 9, 1, 8, 0))).toBe('Yesterday');
  });

  it('has no groups for no lines', () => {
    expect(groupByDay([], now)).toEqual([]);
  });

  it('says why a line cannot be undone, and nothing for one that can', () => {
    expect(stateWords('open')).toBeNull();
    expect(stateWords('log')).toBeNull();
    expect(stateWords('cannot')).toBe('Cannot undo');
    expect(stateWords('safety')).toBe('Safety copy');
    expect(stateWords('changed')).toBe('Changed again');
    expect(stateWords('undone')).toBe('Undone');
  });
});
