import { describe, expect, it } from 'vitest';
import { heldShares, kindSegments } from './share-segments';

describe('kindSegments', () => {
  it('is one box per kind inside a section, each its own colour, leaving out a kind with no rate', () => {
    const segments = kindSegments([
      { key: 'listed_shares', label: 'Listed shares', totalMinor: 13_500_000 },
      { key: 'mutual_funds', label: 'Mutual funds', totalMinor: 20_400_000 },
      { key: 'government_bonds', label: 'Government bonds', totalMinor: 25_100_000 },
      { key: 'foreign', label: 'Foreign shares', totalMinor: null },
    ]);
    expect(segments.map((segment) => segment.key)).toEqual(['listed_shares', 'mutual_funds', 'government_bonds']);
    expect(new Set(segments.map((segment) => segment.className)).size).toBe(3);
    expect(heldShares(segments).heldMinor).toBe(59_000_000);
  });
});
