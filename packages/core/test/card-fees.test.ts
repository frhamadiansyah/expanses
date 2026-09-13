import { describe, expect, it } from 'vitest';
import { cardFeeCategoryIds, computeCycleEarn, type CycleBonus, type EarnRule, isCardFee, type SpendLine } from '../src/index';

const feeIds = cardFeeCategoryIds([
  { id: 'misc', parentId: null, systemKey: 'miscellaneous' },
  { id: 'fees', parentId: 'misc', systemKey: 'miscellaneous.fees_charges' },
  { id: 'annual', parentId: 'misc', systemKey: 'miscellaneous.membership_fee' },
  { id: 'interest', parentId: 'misc', systemKey: 'miscellaneous.interest' },
  { id: 'postage', parentId: 'misc', systemKey: 'miscellaneous.postal_service' },
  { id: 'mine', parentId: 'fees', systemKey: null },
  { id: 'food', parentId: null, systemKey: 'food_beverage' },
  { id: 'dining', parentId: 'food', systemKey: 'food_beverage.restaurants' },
]);

describe('card fees', () => {
  it('finds every fee category and anything under them, but not their siblings', () => {
    expect([...feeIds].sort()).toEqual(['annual', 'fees', 'interest', 'mine']);
    // Miscellaneous holds the fee categories but is not one itself, so neither it nor Postage is swept in.
    expect(feeIds.has('misc')).toBe(false);
    expect(feeIds.has('postage')).toBe(false);
  });

  it('recognises fee categories and issuer charge phrases, but not ordinary merchants', () => {
    expect(isCardFee('ANYTHING', 'annual', feeIds)).toBe(true);
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
