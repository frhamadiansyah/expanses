import { describe, expect, it } from 'vitest';
import { computeCycleEarn, type EarnRule, type SpendLine } from '../src/points/earn';

const rule = (over: Partial<EarnRule> & Pick<EarnRule, 'id'>): EarnRule => ({
  name: over.id,
  priority: 0,
  stackable: false,
  match: {},
  rateNum: 1,
  rateDen: 20_000,
  rounding: 'per_increment',
  capSpendMinor: null,
  capPoints: null,
  minTransactionMinor: null,
  validFrom: null,
  validTo: null,
  ...over,
} as EarnRule);

let seq = 0;
const buy = (amountMinor: number, over: Partial<SpendLine> = {}): SpendLine => {
  seq += 1;
  return { transactionId: `p${seq}`, entryId: `e${seq}`, occurredOn: '2026-09-05', categoryId: 'dining', description: 'Merchant', amountMinor, currency: 'IDR', originalCurrency: null, mcc: null, mccSource: null, ...over };
};

const ancestors = { dining: ['food'], food: [], taxi: ['transport'], transport: [] };

const mandiriPrioritas = [
  rule({ id: 'reduced', priority: 20, rateNum: 1, rateDen: 100_000, match: { categoryIds: ['transport'] } }),
  rule({ id: 'foreign', priority: 10, rateNum: 4, rateDen: 20_000, match: { origin: 'foreign' } }),
  rule({ id: 'domestic', priority: 0, rateNum: 3, rateDen: 20_000, match: { origin: 'domestic' } }),
];

const cimb = [
  rule({ id: 'foreign', priority: 10, rateNum: 7.5, rateDen: 50_000, match: { origin: 'foreign' } }),
  rule({ id: 'domestic', priority: 0, rateNum: 2.5, rateDen: 50_000, match: { origin: 'domestic' } }),
];

describe('per-increment earning', () => {
  it('Mandiri domestic Rp 35.000 counts only one Rp 20.000 multiple and earns 3', () => {
    const earn = computeCycleEarn([buy(35_000)], mandiriPrioritas, ancestors);
    expect(earn.pointsByRule).toEqual({ reduced: 0, foreign: 0, domestic: 3 });
    expect(earn.totalPoints).toBe(3);
  });

  it('Mandiri CNY purchase of Rp 40.000 earns 4 per multiple', () => {
    expect(computeCycleEarn([buy(40_000, { originalCurrency: 'CNY' })], mandiriPrioritas, ancestors).pointsByRule.foreign).toBe(8);
  });

  it('a taxi paid in CNY earns the reduced transport rate, not the overseas rate', () => {
    const earn = computeCycleEarn([buy(250_000, { categoryId: 'taxi', originalCurrency: 'CNY' })], mandiriPrioritas, ancestors);
    expect(earn.pointsByRule).toEqual({ reduced: 2, foreign: 0, domestic: 0 });
  });

  it('CIMB Rp 60.000 earns 2,5 domestic and 7,5 foreign', () => {
    expect(computeCycleEarn([buy(60_000)], cimb, ancestors).totalPoints).toBe(2.5);
    expect(computeCycleEarn([buy(60_000, { originalCurrency: 'SGD' })], cimb, ancestors).totalPoints).toBe(7.5);
  });

  it('applies the multiple to a split purchase total per rule', () => {
    const split = [
      { ...buy(15_000), transactionId: 'split', entryId: 's1' },
      { ...buy(15_000, { categoryId: 'dining' }), transactionId: 'split', entryId: 's2' },
    ];
    expect(computeCycleEarn(split, mandiriPrioritas, ancestors).pointsByRule.domestic).toBe(3);
  });

  it('sums half points exactly across many purchases', () => {
    const seven = Array.from({ length: 7 }, () => buy(50_000));
    expect(computeCycleEarn(seven, cimb, ancestors).totalPoints).toBe(17.5);
  });

  it('leaves whole-point per-transaction earning unchanged', () => {
    const base = rule({ id: 'base', rounding: 'per_transaction_floor', rateNum: 1, rateDen: 13_500 });
    expect(computeCycleEarn([buy(21_000_000)], [base], ancestors).totalPoints).toBe(1555);
  });
});
