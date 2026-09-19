import { describe, expect, it } from 'vitest';
import { equalShares, yourShare } from '../src/index';

describe('splitting a bill equally', () => {
  it('divides by everyone including you', () => {
    expect(equalShares(400_000, 3)).toEqual({ yours: 100_000, each: [100_000, 100_000, 100_000] });
  });

  it('gives you the remainder, so the shares add back to the bill', () => {
    const split = equalShares(100, 2);
    expect(split).toEqual({ yours: 34, each: [33, 33] });
    expect(split.yours + split.each.reduce((sum, one) => sum + one, 0)).toBe(100);
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
