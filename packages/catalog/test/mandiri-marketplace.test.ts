import { computeCycleEarn, DEFAULT_CATEGORY_KEYS, type SpendLine } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { findEntry, planCatalogApply } from '../src/index';

const ids = Object.fromEntries([...DEFAULT_CATEGORY_KEYS].map((key) => [key, [key]]));
const earn = (lines: SpendLine[]) => {
  const plan = planCatalogApply(findEntry('mandiri-world-prioritas')!, ids, '2026-09-11');
  const rules = plan.rules.map(({ catalogKey, ...rule }) => ({ ...rule, id: catalogKey }));
  return computeCycleEarn(lines, rules, {}, { bonuses: [], cycleEnd: '2026-09-25' });
};
const line = (mcc: string): SpendLine => ({
  transactionId: `t${mcc}`, entryId: `e${mcc}`, occurredOn: '2026-09-15', categoryId: 'shopping.online', description: 'A SHOP',
  amountMinor: 200_000, currency: 'IDR', originalCurrency: null, mcc, mccSource: 'typed',
});

describe('Mandiri World Prioritas, rupiah purchases under marketplace and catalogue codes', () => {
  it('earn at the domestic rate, 3 per Rp 20.000', () => {
    for (const mcc of ['5262', '5964']) {
      const result = earn([line(mcc)]);
      expect(result.totalPoints, mcc).toBe(30);
      expect(result.unearnedSpendMinor, mcc).toBe(0);
    }
  });
});
