import { describe, expect, it } from 'vitest';
import { couponDatesBetween, couponGrossMinor, couponTaxMinor, dueCouponDates, nextCouponOn, previousCouponOn } from '../src/index';

describe('bond coupons', () => {
  it('is par × rate ÷ payments a year, with the tax at its own rate', () => {
    // Rp10.000.000 at 6,30% a year, paid monthly: Rp52.500 a month, Rp5.250 of it withheld at 10%.
    const gross = couponGrossMinor({ parUnitsMicro: 10_000_000 * 1_000_000, rateBps: 630, perYear: 12, currency: 'IDR' });
    expect(gross).toBe(52_500);
    expect(couponTaxMinor(gross, 1_000)).toBe(5_250);
    expect(couponGrossMinor({ parUnitsMicro: 10_000_000 * 1_000_000, rateBps: 630, perYear: 2, currency: 'IDR' })).toBe(315_000);
    expect(couponGrossMinor({ parUnitsMicro: 1_000 * 1_000_000, rateBps: 425, perYear: 2, currency: 'USD' })).toBe(2_125);
  });

  it('steps a month or six on the pay day, and on a short month its last day', () => {
    expect(nextCouponOn('2026-10-15', 12, 15)).toBe('2026-11-15');
    expect(nextCouponOn('2026-12-15', 12, 15)).toBe('2027-01-15');
    expect(nextCouponOn('2026-08-31', 2, 31)).toBe('2027-02-28');
    expect(nextCouponOn('2027-02-28', 2, 31)).toBe('2027-08-31');
    expect(nextCouponOn('2026-11-15', 4, 15)).toBe('2027-02-15');
    expect(nextCouponOn('2026-11-15', 1, 15)).toBe('2027-11-15');
  });

  it('owes every payment up to today, and none past maturity', () => {
    expect(dueCouponDates({ nextOn: '2026-08-15', perYear: 12, payDay: 15, maturesOn: null, today: '2026-10-22' })).toEqual(['2026-08-15', '2026-09-15', '2026-10-15']);
    expect(dueCouponDates({ nextOn: '2026-08-15', perYear: 12, payDay: 15, maturesOn: '2026-09-15', today: '2026-10-22' })).toEqual(['2026-08-15', '2026-09-15']);
    expect(dueCouponDates({ nextOn: '2026-11-15', perYear: 12, payDay: 15, maturesOn: null, today: '2026-10-22' })).toEqual([]);
  });
});

describe('a bond’s schedule over a stretch of time', () => {
  it('walks back from the next payment and forward to the end, never past maturity', () => {
    expect(previousCouponOn('2027-02-28', 2, 31)).toBe('2026-08-31');
    expect(couponDatesBetween({ nextOn: '2026-11-15', perYear: 4, payDay: 15, maturesOn: null, from: '2026-01-01', to: '2027-03-31' })).toEqual([
      '2026-02-15', '2026-05-15', '2026-08-15', '2026-11-15', '2027-02-15',
    ]);
    expect(couponDatesBetween({ nextOn: '2026-11-15', perYear: 2, payDay: 15, maturesOn: '2026-11-15', from: '2026-01-01', to: '2027-12-31' })).toEqual(['2026-05-15', '2026-11-15']);
  });
});
