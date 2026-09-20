import { describe, expect, it } from 'vitest';
import { equalShares, yourShare } from '../src/index';

describe('splitting a bill equally', () => {
  it('divides by everyone including you', () => {
    expect(equalShares(400_000, 3)).toEqual({ yours: 100_000, each: [100_000, 100_000, 100_000] });
  });

  /*
   * Floored, never rounded — and this is where that is held.
   *
   * Both of the examples this file used to carry agreed under either rule: 400.000 between three divides
   * exactly, and 100 between two gives 33,33, which floors and rounds alike to 33. Turning `Math.floor` into
   * `Math.round` left all 698 tests in this package green, and the remainder rule survived only because one
   * fixture in `apps/web` happened to discriminate — the rule's home test could not tell the two apart.
   *
   * 5 between two can. Floored, each friend owes 1 and you carry 3; rounded, each owes 2 and you carry 1 —
   * so a rounded share asks a friend for more than their share of the bill, which is the thing the rule is
   * for. The whole answer is asserted, not only `yours`, so neither half can drift alone.
   */
  it('floors each share, so nobody is asked for more than their share', () => {
    expect(equalShares(5, 2)).toEqual({ yours: 3, each: [1, 1] });
  });

  it('gives you the remainder, so the shares add back to the bill', () => {
    const split = equalShares(100, 2);
    expect(split).toEqual({ yours: 34, each: [33, 33] });
    expect(split.yours + split.each.reduce((sum, one) => sum + one, 0)).toBe(100);
    // And it still adds back where floor and round differ, which is the case that can catch a changed rule.
    const odd = equalShares(5, 2);
    expect(odd.yours + odd.each.reduce((sum, one) => sum + one, 0)).toBe(5);
  });

  it('is the whole bill when nobody else was there', () => {
    expect(equalShares(85_000, 0)).toEqual({ yours: 85_000, each: [] });
  });
});

describe('typing each share', () => {
  it('leaves you the rest', () => {
    expect(yourShare(400_000, [150_000, 120_000])).toBe(130_000);
  });

  it('can leave you nothing at all', () => {
    expect(yourShare(400_000, [400_000])).toBe(0);
  });

  it('refuses shares that come to more than the bill', () => {
    expect(() => yourShare(400_000, [300_000, 200_000])).toThrow(/more than the bill/);
  });
});
