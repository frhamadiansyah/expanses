import { describe, expect, it } from 'vitest';
import { CURRENCIES, currencyInfo } from '../src/index';

describe('the flag on the amount row', () => {
  it('is there for every currency the app knows', () => {
    expect(CURRENCIES.filter((c) => !c.flag)).toEqual([]);
  });

  it('is the country the money belongs to', () => {
    expect(currencyInfo('IDR').flag).toBe('🇮🇩');
    expect(currencyInfo('JPY').flag).toBe('🇯🇵');
    expect(currencyInfo('EUR').flag).toBe('🇪🇺');
  });
});
