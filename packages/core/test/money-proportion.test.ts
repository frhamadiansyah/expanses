import { describe, expect, it } from 'vitest';
import { partFigures, proportionalMinor } from '../src/index';

describe('proportionalMinor', () => {
  it('is the same share of the other figure, rounded half away from zero', () => {
    // A part of Rp 1.296.000 of a Rp 1.944.000 charge that was USD 120,00: USD 80,00.
    expect(proportionalMinor(1_296_000, 1_944_000, 12_000)).toBe(8_000);
    expect(proportionalMinor(8_000, 12_000, 1_944_000)).toBe(1_296_000);
    // 1 of 3 of 100 is 33.33…; 2 of 3 is 66.66…; a half rounds away from nought.
    expect(proportionalMinor(1, 3, 100)).toBe(33);
    expect(proportionalMinor(2, 3, 100)).toBe(67);
    expect(proportionalMinor(1, 2, 3)).toBe(2);
    expect(proportionalMinor(-1, 2, 3)).toBe(-2);
  });

  it('stays exact past what a double holds whole', () => {
    // 9.000.000.000 × 9.000.000 is past 2^53; the share is still to the unit.
    expect(proportionalMinor(9_000_000_000, 9_000_000_001, 9_000_000)).toBe(9_000_000);
  });

  it('is nothing of nothing', () => {
    expect(proportionalMinor(500, 0, 100)).toBe(0);
  });
});

describe('partFigures', () => {
  it('gives each part its share, the last taking what rounding leaves, so they add up exactly', () => {
    expect(partFigures([1_296_000, 648_000], 1_944_000, 12_000)).toEqual([8_000, 4_000]);
    // Thirds: 33 + 33 + 34.
    expect(partFigures([1, 1, 1], 3, 100)).toEqual([33, 33, 34]);
    const parts = partFigures([700_001, 600_003, 643_996], 1_944_000, 12_000);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(12_000);
  });

  it('reads a part typed in the finer-grained figure back as it was typed', () => {
    // An invented charge: USD 123,45 charged Rp 2.017.523. Every cents figure a part could be typed in comes back.
    const charged = 2_017_523;
    const original = 12_345;
    for (let cents = 1; cents < original; cents += 7) {
      const rupiah = proportionalMinor(cents, original, charged);
      const [back, rest] = partFigures([rupiah, charged - rupiah], charged, original);
      expect(back).toBe(cents);
      expect(rest).toBe(original - cents);
    }
  });

  it('is empty for no parts and nothing for a whole of nothing', () => {
    expect(partFigures([], 100, 50)).toEqual([]);
    expect(partFigures([0, 0], 0, 50)).toEqual([0, 0]);
  });
});
