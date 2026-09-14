import { describe, expect, it } from 'vitest';
import type { EarnRule } from '../src/points/earn';
import type { RedemptionCap } from '../src/points/transfer';
import { type CardCandidate, recommendCards } from '../src/points/recommend';

const kf = { id: 'kf', key: 'krisflyer', program: 'KrisFlyer', points: 200, partnerUnits: 100, incrementPoints: 20, validFrom: null, validTo: null };

const garuda = { id: 'ga', key: 'garudamiles', program: 'GarudaMiles', points: 150, partnerUnits: 100, incrementPoints: 15, validFrom: '2025-11-01', validTo: null };

/** A redemption cap with the fields a test does not care about filled in. */
const cap = (over: Partial<RedemptionCap>): RedemptionCap => ({
  window: 'month', capPoints: null, capPartnerUnits: null, shared: false, beyond: null, ...over,
});

describe('transfer conversion', () => {
  it('converts balances in whole increments', async () => {
    const { convertPoints } = await import('../src/points/transfer');
    expect(convertPoints(1240, kf)).toBe(620);
    expect(convertPoints(1240, garuda)).toBe(820);
    expect(convertPoints(1245.5, kf)).toBe(620);
    expect(convertPoints(19, kf)).toBe(0);
  });

  it('estimates single purchases without increment rounding', async () => {
    const { estimatePartnerUnits } = await import('../src/points/transfer');
    expect(estimatePartnerUnits(54, kf)).toBe(27);
    expect(estimatePartnerUnits(55, kf)).toBe(27);
  });

  it('stops at a hard ceiling, in whole steps', async () => {
    const { convertDetail } = await import('../src/points/transfer');
    // 100.000 a month, moving in 1.000 steps, nothing past it.
    const capped = { ...kf, points: 1000, partnerUnits: 1000, incrementPoints: 1000, cap: cap({ capPoints: 100_000 }) };
    expect(convertDetail(60_000, capped)).toEqual({ units: 60_000, fullRatePoints: 60_000, beyondPoints: 0, unconvertedPoints: 0 });
    expect(convertDetail(160_000, capped)).toEqual({ units: 100_000, fullRatePoints: 100_000, beyondPoints: 0, unconvertedPoints: 60_000 });
  });

  it('spends the ceiling in whole steps, so a step straddling it waits', async () => {
    const { convertPoints } = await import('../src/points/transfer');
    // Mandiri: 25.000 a month at one for one, in 10.000 steps, then 3.000 for 1.000.
    const livin = { ...kf, points: 1, partnerUnits: 1, incrementPoints: 10_000, cap: cap({ capPoints: 25_000, beyond: { points: 3000, partnerUnits: 1000 } }) };
    // Only two whole steps fit under 25.000, so 20.000 moves one for one and the next 20.000 at a third.
    expect(convertPoints(40_000, livin)).toBe(20_000 + 6_666);
    expect(convertPoints(20_000, livin)).toBe(20_000);
  });

  it('reads a ceiling published in partner units through the ratio it is published against', async () => {
    const { capInPoints, convertPoints } = await import('../src/points/transfer');
    // Jenius KrisFlyer: 40.000 Yay give 30.000 miles, and 30.000 miles a month is the ceiling.
    const yay = { ...kf, points: 40_000, partnerUnits: 30_000, incrementPoints: 40_000, cap: cap({ capPartnerUnits: 30_000 }) };
    expect(capInPoints(yay)).toBe(40_000);
    expect(convertPoints(120_000, yay)).toBe(30_000);
  });

  it('refuses a balance below the minimum, then moves it in the smaller step', async () => {
    const { convertDetail, convertPoints } = await import('../src/points/transfer');
    // Mandiri: 10.000 opens a conversion, 1.000 at a time after that.
    const livin = { ...kf, points: 1, partnerUnits: 1, incrementPoints: 1000, minimumPoints: 10_000 };
    expect(convertDetail(9_999, livin)).toEqual({ units: 0, fullRatePoints: 0, beyondPoints: 0, unconvertedPoints: 9_999 });
    expect(convertPoints(10_000, livin)).toBe(10_000);
    expect(convertPoints(15_500, livin)).toBe(15_000);
  });

  it('applies the minimum before the ceiling, not instead of it', async () => {
    const { convertPoints } = await import('../src/points/transfer');
    const livin = {
      ...kf, points: 1, partnerUnits: 1, incrementPoints: 1000, minimumPoints: 10_000,
      cap: cap({ capPoints: 25_000, beyond: { points: 3000, partnerUnits: 1000 } }),
    };
    expect(convertPoints(9_000, livin)).toBe(0);
    expect(convertPoints(40_000, livin)).toBe(25_000 + 5_000);
  });

  it('leaves an uncapped partner exactly as it was', async () => {
    const { convertPoints } = await import('../src/points/transfer');
    expect(convertPoints(1240, kf)).toBe(620);
    expect(convertPoints(1240, { ...kf, cap: null })).toBe(620);
  });

  it('finds partners by program and validity date', async () => {
    const { partnerFor } = await import('../src/points/transfer');
    expect(partnerFor([kf, garuda], 'GarudaMiles', '2025-10-31')).toBeNull();
    expect(partnerFor([kf, garuda], 'GarudaMiles', '2025-11-01')?.id).toBe('ga');
    expect(partnerFor([kf, garuda], 'Asia Miles', '2026-09-11')).toBeNull();
  });
});

const rule = (over: Partial<EarnRule> & Pick<EarnRule, 'id'>): EarnRule => ({
  name: over.id, priority: 0, stackable: false, match: {}, rateNum: 1, rateDen: 10_000, rounding: 'per_transaction_floor',
  capSpendMinor: null, capPoints: null, minTransactionMinor: null, validFrom: null, validTo: null, ...over,
});

const infinite: CardCandidate = {
  cardAccountId: 'infinite', cardName: 'KrisFlyer Visa Infinite', currency: 'IDR', programName: 'KrisFlyer',
  rules: [rule({ id: 'inf-base', rateDen: 10_800 })], bonuses: [], transferPartners: [], cycleLines: [], bestRedemption: null,
};
const unionpay: CardCandidate = {
  cardAccountId: 'unionpay', cardName: 'BCA UnionPay', currency: 'IDR', programName: 'UnionPay Points',
  rules: [rule({ id: 'up-base' }), rule({ id: 'up-double', stackable: true, match: { currencies: ['SGD', 'HKD', 'CNY', 'TWD'] } })],
  bonuses: [], transferPartners: [kf], cycleLines: [], bestRedemption: { valueMinor: 20, perPoints: 1, currency: 'IDR' },
};
const marriott: CardCandidate = {
  cardAccountId: 'marriott', cardName: 'Marriott Bonvoy', currency: 'IDR', programName: 'Marriott Bonvoy',
  rules: [rule({ id: 'mb-base', rounding: 'per_increment', rateNum: 3, rateDen: 20_000 })], bonuses: [], transferPartners: [], cycleLines: [], bestRedemption: null,
};
const query = { amountMinor: 1_080_000, currency: 'IDR', originalCurrency: null, mcc: null, categoryId: 'dining', description: 'Restaurant', occurredOn: '2026-09-11' };

describe('compare in a miles program', () => {
  it('ranks direct KrisFlyer miles against converted UnionPay points for a rupiah purchase', () => {
    const recs = recommendCards(query, [unionpay, marriott, infinite], {}, { kind: 'program', program: 'KrisFlyer' });
    expect(recs.map((r) => [r.cardAccountId, r.points, r.compareUnits, r.comparable])).toEqual([
      ['infinite', 100, 100, true],
      ['unionpay', 108, 54, true],
      ['marriott', 162, null, false],
    ]);
  });

  it('lets UnionPay double points win an SGD purchase', () => {
    const recs = recommendCards({ ...query, originalCurrency: 'SGD' }, [infinite, unionpay], {}, { kind: 'program', program: 'KrisFlyer' });
    expect(recs.map((r) => [r.cardAccountId, r.points, r.compareUnits])).toEqual([
      ['unionpay', 216, 108],
      ['infinite', 100, 100],
    ]);
  });

  it('adds a cycle bonus tier crossed by the purchase to marginal points', () => {
    const signature: CardCandidate = {
      ...infinite,
      cardAccountId: 'signature',
      rules: [rule({ id: 'sig-base', rateDen: 13_500 })],
      bonuses: [{ id: 'sig-bonus', key: 'monthly-spend', name: 'Monthly spend bonus', tiers: [{ minSpendMinor: 20_000_000, bonus: 1000 }], match: {}, validFrom: null, validTo: null }],
      cycleLines: [{ transactionId: 'earlier', entryId: 'earlier-e', occurredOn: '2026-09-02', categoryId: 'dining', description: 'Earlier', amountMinor: 19_500_000, currency: 'IDR', originalCurrency: null, mcc: null, mccSource: null }],
    };
    const [rec] = recommendCards({ ...query, amountMinor: 1_000_000 }, [signature], {}, { kind: 'program', program: 'KrisFlyer' });
    expect(rec!.points).toBe(74 + 1000);
    expect(rec!.compareUnits).toBe(1074);
  });
});
