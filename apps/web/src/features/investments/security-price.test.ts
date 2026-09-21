import { formatMinor } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { changeText, lastPriceOnOrBefore, planPriceSave, typedPrice } from './security-price';

const TODAY = '2026-09-22';
const aapl = { id: 'aapl', currency: 'USD' };
const bbca = { id: 'bbca', currency: 'IDR' };
// Newest first, as `listSecurityPrices` returns them.
const prices = [
  { onDate: '2026-09-20', priceMicro: 9_775_000_000 },
  { onDate: '2026-09-01', priceMicro: 9_550_000_000 },
  { onDate: '2026-08-01', priceMicro: 9_100_000_000 },
];

describe('the price page', () => {
  it('reads a price in the stock’s own currency, not the base one', () => {
    // "214,30" is $214,30 — 21.430 cents; read in rupiah it would be Rp 214,30, a hundredth of that.
    expect(planPriceSave({ security: aapl, price: '214,30', onDate: TODAY, today: TODAY })).toEqual({ securityId: 'aapl', onDate: TODAY, priceMicro: 21_430_000_000 });
    expect(planPriceSave({ security: bbca, price: '9.775', onDate: TODAY, today: TODAY }).priceMicro).toBe(9_775_000_000);
    expect(typedPrice('214,30', aapl)).toBe(21_430_000_000);
    expect(typedPrice('214,30', bbca)).toBe(214_300_000);
  });

  it('moves "This changes" from the last price on or before the chosen day, never a later one', () => {
    expect(lastPriceOnOrBefore(prices, TODAY)?.onDate).toBe('2026-09-20');
    expect(lastPriceOnOrBefore(prices, '2026-09-10')?.onDate).toBe('2026-09-01');
    expect(lastPriceOnOrBefore(prices, '2026-09-01')?.onDate).toBe('2026-09-01');
    expect(lastPriceOnOrBefore(prices, '2026-07-01')).toBeNull();
  });

  it('refuses a price dated after today', () => {
    expect(() => planPriceSave({ security: bbca, price: '9.775', onDate: '2026-09-23', today: TODAY })).toThrow('A price cannot be dated after today');
  });

  it('waits for the stock before reading or saving a price', () => {
    expect(typedPrice('9.775', undefined)).toBeNull();
    expect(() => planPriceSave({ security: undefined, price: '9.775', onDate: TODAY, today: TODAY })).toThrow();
    expect(typedPrice('', bbca)).toBeNull();
    expect(typedPrice('abc', bbca)).toBeNull();
  });

  it('signs a change up, leaves a fall to the formatter, and gives no change no sign', () => {
    expect(changeText(225_000, 'IDR')).toBe(`+${formatMinor(225_000, 'IDR')}`);
    expect(changeText(-112_500, 'IDR')).toBe(formatMinor(-112_500, 'IDR'));
    expect(changeText(0, 'IDR')).toBe(formatMinor(0, 'IDR'));
  });
});
