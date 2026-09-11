import { describe, expect, it } from 'vitest';
import { cardFeeCategoryIds, computeCycleEarn, type CycleBonus, type EarnRule, isCardFee, type SpendLine } from '../src/index';

const feeIds = cardFeeCategoryIds([
  { id: 'fees', parentId: null, systemKey: 'fees' },
  { id: 'stamp', parentId: 'fees', systemKey: 'fees.stamp_duty' },
  { id: 'mine', parentId: 'fees', systemKey: null },
  { id: 'food', parentId: null, systemKey: 'food' },
  { id: 'dining', parentId: 'food', systemKey: 'food.dining' },
]);

describe('card fees', () => {
  it('finds the fees category and everything under it', () => {
    expect([...feeIds].sort()).toEqual(['fees', 'mine', 'stamp']);
  });

  it('recognises fee categories and issuer charge phrases, but not ordinary merchants', () => {
    expect(isCardFee('ANYTHING', 'stamp', feeIds)).toBe(true);
    for (const description of ['BIAYA NOTIFIKASI SMS', 'BEA MATERAI', 'Stamp Duty', 'BIAYA ADMINISTRASI KARTU', 'IURAN TAHUNAN KARTU UTAMA', 'LATE PAYMENT FEE']) {
      expect(isCardFee(description, 'dining', feeIds), description).toBe(true);
    }
    for (const description of ['TOKO BUNGA MAWAR', 'SUPERINDO', 'MATERIAL BANGUNAN']) expect(isCardFee(description, 'dining', feeIds), description).toBe(false);
  });

  it('never earns or counts toward bonuses, and is reported apart from unmatched spend', () => {
    const rule: EarnRule = {
      id: 'base', name: 'Base', priority: 0, stackable: false, match: {}, rateNum: 1, rateDen: 20_000, rounding: 'per_increment',
      capSpendMinor: null, capPoints: null, minTransactionMinor: null, validFrom: null, validTo: null,
    };
    const bonus: CycleBonus = { id: 'm', key: 'm', name: 'Milestone', tiers: [{ minSpendMinor: 100_000, bonus: 500 }], match: {}, validFrom: null, validTo: null };
    const line = (transactionId: string, amountMinor: number, cardFee = false): SpendLine => ({
      transactionId, entryId: `${transactionId}-1`, occurredOn: '2026-09-05', categoryId: 'dining', description: transactionId,
      amountMinor, currency: 'IDR', originalCurrency: null, mcc: null, mccSource: null, cardFee,
    });
    const earn = computeCycleEarn([line('dinner', 60_000), line('fee', 100_000, true), line('fee-reversal', -50_000, true)], [rule], {}, { bonuses: [bonus] });
    expect(earn.totalPoints).toBe(3);
    expect(earn.cardFeeSpendMinor).toBe(100_000);
    expect(earn.unearnedSpendMinor).toBe(0);
    expect(earn.eligibleSpendByBonus.m).toBe(60_000);
    expect(earn.pointsByTransaction).toEqual({ dinner: 3 });
  });
});
