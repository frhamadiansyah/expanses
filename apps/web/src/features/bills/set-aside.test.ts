import { describe, expect, it } from 'vitest';
import { setAsideOf } from './set-aside';

const fund = (over: Partial<{ monthlyMinor: number; savedMinor: number; targetMinor: number; currency: string }> = {}) => ({
  monthlyMinor: 100,
  savedMinor: 300,
  targetMinor: 1200,
  currency: 'IDR',
  ...over,
});

describe('setAsideOf', () => {
  it('adds the monthly amounts, the saved and the targets', () => {
    expect(setAsideOf([fund(), fund({ monthlyMinor: 50, savedMinor: 100, targetMinor: 600 })], 'IDR')).toEqual({
      monthlyMinor: 150,
      savedMinor: 400,
      targetMinor: 1800,
      count: 2,
      approximate: false,
    });
  });
  it('is zero with no funds', () => {
    expect(setAsideOf([], 'IDR')).toEqual({ monthlyMinor: 0, savedMinor: 0, targetMinor: 0, count: 0, approximate: false });
  });
  it('converts a fund in another currency, and leaves one out that no rate reaches', () => {
    const usd = fund({ currency: 'USD', monthlyMinor: 1, savedMinor: 2, targetMinor: 3 });
    expect(setAsideOf([fund(), usd], 'IDR', (m, from) => (from === 'USD' ? m * 10 : null))).toMatchObject({
      monthlyMinor: 110,
      savedMinor: 320,
      targetMinor: 1230,
      approximate: false,
    });
    expect(setAsideOf([fund(), usd], 'IDR')).toMatchObject({ monthlyMinor: 100, count: 2, approximate: true });
  });
});
