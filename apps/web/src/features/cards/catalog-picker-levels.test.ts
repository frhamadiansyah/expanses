import type { CatalogEntry } from '@expanses/catalog';
import { describe, expect, it } from 'vitest';
import { canApplyEntry, memberLevelsOf } from './catalog-picker';

const withLevels = (levels: { key: string; name: string; condition: string }[] | undefined) =>
  ({ program: { unit: 'points', name: 'Test Points', cycleAnchor: 'statement', memberLevels: levels } } as CatalogEntry);

describe('choosing a member level before applying', () => {
  it('lists the levels the entry publishes, in the bank’s order', () => {
    const entry = withLevels([
      { key: 'bloom', name: 'Bloom', condition: 'Rp 10.000.000 or more' },
      { key: 'seed', name: 'Seed', condition: 'below Rp 10.000.000' },
    ]);
    expect(memberLevelsOf(entry).map((level) => level.key)).toEqual(['bloom', 'seed']);
  });

  it('has no levels for a card that earns the same for everyone', () => {
    expect(memberLevelsOf(withLevels(undefined))).toEqual([]);
  });

  it('a card with no levels can be applied straight away', () => {
    expect(canApplyEntry(withLevels(undefined), null)).toBe(true);
  });

  it('a card that earns by standing waits until a level is chosen', () => {
    const entry = withLevels([{ key: 'bloom', name: 'Bloom', condition: 'Rp 10.000.000 or more' }]);
    expect(canApplyEntry(entry, null)).toBe(false);
    expect(canApplyEntry(entry, 'bloom')).toBe(true);
  });

  it('a level the entry does not publish does not unlock it', () => {
    const entry = withLevels([{ key: 'bloom', name: 'Bloom', condition: 'Rp 10.000.000 or more' }]);
    expect(canApplyEntry(entry, 'platinum')).toBe(false);
  });
});
