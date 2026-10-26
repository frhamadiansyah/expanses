import { computeCycleEarn, DEFAULT_CATEGORY_KEYS, type SpendLine } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { findEntry, planCatalogApply } from '../src/index';

const ids = Object.fromEntries([...DEFAULT_CATEGORY_KEYS].map((key) => [key, [key]]));
const earn = (lines: SpendLine[]) => {
  const plan = planCatalogApply(findEntry('mandiri-world-prioritas')!, ids, '2026-09-11');
  const rules = plan.rules.map(({ catalogKey, ...rule }) => ({ ...rule, id: catalogKey }));
  return computeCycleEarn(lines, rules, {}, { bonuses: [], cycleEnd: '2026-09-25' });
};
let seq = 0;
const line = (over: Partial<SpendLine>): SpendLine => {
  seq += 1;
  return {
    transactionId: `t${seq}`, entryId: `e${seq}`, occurredOn: '2026-09-15', categoryId: 'shopping.online', description: 'A SHOP',
    amountMinor: 200_000, currency: 'IDR', originalCurrency: 'USD', mcc: '5262', mccSource: 'typed', ...over,
  };
};

describe('Mandiri World Prioritas, marketplace and catalogue merchant codes', () => {
  it('pays 5262 and 5964 at the domestic rate even when the purchase was billed from another currency', () => {
    // Rp 200.000 billed in rupiah from a foreign merchant: overseas would be 4 per Rp 20.000, domestic is 3.
    for (const mcc of ['5262', '5964']) expect(earn([line({ mcc })]).totalPoints, mcc).toBe(30);
  });

  it('still pays the overseas rate for another code billed from a foreign currency', () => {
    expect(earn([line({ mcc: '5812' })]).totalPoints).toBe(40);
  });

  it('leaves a rupiah purchase under those codes at the domestic rate', () => {
    expect(earn([line({ mcc: '5262', originalCurrency: null })]).totalPoints).toBe(30);
  });
});
