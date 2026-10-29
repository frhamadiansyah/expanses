import type { ReviewItem } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { byKind, filterKinds, hiddenIds, newItemShared, sharedCount, sharedValue, withShared } from './net-worth-items';

const item = (accountId: string, name: string, subtype: string, kind: 'asset' | 'liability' = 'asset', setting: ReviewItem['setting'] = null): ReviewItem => ({ accountId, name, subtype, kind, setting });
const items = [item('1', 'BCA Tahapan', 'bank'), item('2', 'Gold bar', 'gold'), item('3', 'Car loan', 'loan', 'liability'), item('4', 'Mandiri Giro', 'bank', 'asset', 'hidden')];

describe('Shared list', () => {
  it('groups by kind, assets before debts', () => {
    const kinds = byKind([items[2]!, ...items.slice(0, 2), items[3]!]);
    expect(kinds.map((k) => k.key)).toEqual(['bank', 'gold', 'loan']);
    expect(kinds[0]!.items.map((i) => i.name)).toEqual(['BCA Tahapan', 'Mandiri Giro']);
  });

  it('searches by name, case-insensitively, and drops kinds with no rows left', () => {
    const kinds = byKind(items);
    expect(filterKinds(kinds, 'bca').map((k) => k.key)).toEqual(['bank']);
    expect(filterKinds(kinds, 'bca')[0]!.items).toHaveLength(1);
    expect(filterKinds(kinds, 'GOLD').map((k) => k.key)).toEqual(['gold']);
    expect(filterKinds(kinds, '  ')).toHaveLength(kinds.length);
    expect(filterKinds(kinds, 'zzz')).toEqual([]);
  });

  it('counts and words the shared items', () => {
    expect(sharedCount(items, new Set(['4']))).toBe(3);
    expect(sharedValue(4, 4)).toBe('All 4');
    expect(sharedValue(3, 4)).toBe('3 of 4');
  });

  it('reads and edits the private ids', () => {
    expect(hiddenIds(items)).toEqual(['4']);
    expect(withShared(['4'], '1', false)).toEqual(['4', '1']);
    expect(withShared(['4', '1'], '4', true)).toEqual(['1']);
  });

  it('starts a new item shared only while sharing is active', () => {
    expect(newItemShared(true)).toBe(true);
    expect(newItemShared(false)).toBeNull();
  });
});
