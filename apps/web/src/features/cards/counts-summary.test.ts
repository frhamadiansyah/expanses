import type { AccountRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { countsSummary } from './CountsRow';

const accounts = [
  { id: 'a', name: 'Shopping' },
  { id: 'b', name: 'Transport' },
  { id: 'c', name: 'Fees' },
] as AccountRow[];

describe('countsSummary', () => {
  it('reads All purchases when empty, or the word given for a list that excludes', () => {
    expect(countsSummary(accounts, [])).toBe('All purchases');
    expect(countsSummary(accounts, [], 'None')).toBe('None');
  });

  it('names up to two, then counts the rest', () => {
    expect(countsSummary(accounts, ['a', 'b'], 'None')).toBe('Shopping, Transport');
    expect(countsSummary(accounts, ['a', 'b', 'c'])).toBe('Shopping, Transport +1');
  });
});
