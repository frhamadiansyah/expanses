import { describe, expect, it } from 'vitest';
import { gramPriceMicroFromOunce, wantsWorldPrice } from '../src/index';

describe('the world gold price, a gram at a time', () => {
  it('divides an ounce into grams, kept as millionths of a minor unit', () => {
    // 74.639.548 rupiah an ounce is 2.399.717,19… a gram.
    expect(gramPriceMicroFromOunce(74_639_548, 'IDR')).toBe(Math.round((74_639_548 / 31.1034768) * 1_000_000));
    expect(gramPriceMicroFromOunce(74_639_548, 'IDR') / 1_000_000).toBeCloseTo(2_399_717.19, 1);
    // A currency with cents keeps them: 3.800 dollars an ounce is 122,17 a gram.
    expect(gramPriceMicroFromOunce(3_800, 'USD') / 1_000_000 / 100).toBeCloseTo(122.17, 2);
  });

  it('refuses a price of nothing', () => {
    expect(() => gramPriceMicroFromOunce(0, 'IDR')).toThrow();
  });
});

describe('which price is the day’s', () => {
  it('fetches only for a holding that follows the world price and has nothing for today', () => {
    expect(wantsWorldPrice('world', null, '2026-09-30')).toBe(true);
    expect(wantsWorldPrice('world', { onDate: '2026-09-29' }, '2026-09-30')).toBe(true);
    expect(wantsWorldPrice('world', { onDate: '2026-09-30' }, '2026-09-30')).toBe(false);
    expect(wantsWorldPrice('typed', null, '2026-09-30')).toBe(false);
  });
});
