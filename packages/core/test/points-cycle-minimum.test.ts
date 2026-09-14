import { describe, expect, it } from 'vitest';
import { computeCycleEarn, type EarnRule, type SpendLine } from '../src/points/earn';

const rule = (over: Partial<EarnRule> & Pick<EarnRule, 'id'>): EarnRule => ({
  name: over.id,
  priority: 0,
  stackable: false,
  match: {},
  rateNum: 1,
  rateDen: 2500,
  rounding: 'per_increment',
  capSpendMinor: null,
  capPoints: null,
  minTransactionMinor: null,
  validFrom: null,
  validTo: null,
  ...over,
});

let seq = 0;
const line = (amountMinor: number, occurredOn = '2026-09-05'): SpendLine => {
  seq += 1;
  const id = `t${String(seq).padStart(4, '0')}`;
  return { transactionId: id, entryId: `${id}e`, occurredOn, categoryId: 'shopping', description: 'shop', amountMinor, currency: 'IDR', originalCurrency: null, mcc: null, mccSource: null };
};

const ancestors = { shopping: [] };

/** Danamon's shape: everything earns the base, and an uplift joins in once the month's spend reaches a floor. */
const base = rule({ id: 'base', rateNum: 1 });
const uplift = rule({ id: 'uplift', rateNum: 2, stackable: true, minCycleSpendMinor: 1_500_000 });

const points = (lines: SpendLine[], rules = [base, uplift]) => computeCycleEarn(lines, rules, ancestors).totalPoints;

describe('a rule that needs the cycle to reach a spend floor', () => {
  it('earns nothing while the cycle is below the floor', () => {
    // Rp 1.000.000 at 1 per Rp 2.500 is 400, and the uplift stays out.
    expect(points([line(1_000_000)])).toBe(400);
  });

  it('joins in once the floor is reached, over the whole cycle rather than the excess', () => {
    // Rp 1.500.000 at 1 + 2 per Rp 2.500 is 600 + 1.200.
    expect(points([line(1_500_000)])).toBe(1_800);
  });

  it('counts the cycle in total, not each purchase, so small purchases add up to it', () => {
    const lines = [line(500_000), line(500_000), line(500_000)];
    expect(points(lines)).toBe(1_800);
    // One rupiah short and only the base earns.
    expect(points([line(500_000), line(500_000), line(499_999)])).toBe(599);
  });

  it('is not the same as a floor per purchase', () => {
    const perPurchase = rule({ id: 'uplift', rateNum: 2, stackable: true, minTransactionMinor: 1_500_000 });
    const lines = [line(500_000), line(500_000), line(500_000)];
    // The per-purchase floor rejects every line; the cycle floor accepts them all.
    expect(points(lines, [base, perPurchase])).toBe(600);
    expect(points(lines)).toBe(1_800);
  });

  it('counts refunds against the floor, as a cancelled purchase should', () => {
    const purchase = line(1_500_000);
    const refund = { ...line(0), transactionId: 'r1', entryId: 'r1e', amountMinor: -500_000 };
    // Rp 1.500.000 less a Rp 500.000 refund is Rp 1.000.000, under the floor: base only, net of the refund.
    expect(points([purchase, refund])).toBe(400);
  });

  it('leaves a rule without a floor alone', () => {
    expect(points([line(10_000)], [base])).toBe(4);
  });

  it('applies the floor to the rule that carries it, not to its neighbours', () => {
    const other = rule({ id: 'other', rateNum: 5, stackable: true });
    // The uplift is out below the floor, but `other` still earns on the same spend.
    expect(points([line(1_000_000)], [base, uplift, other])).toBe(400 + 2_000);
  });
});
