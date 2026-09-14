import { computeCycleEarn, DEFAULT_CATEGORY_KEYS, type SpendLine } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { CATALOG, findEntry, MERCHANTS, planCatalogApply, validateMerchants } from '../src/index';

const ids = Object.fromEntries([...DEFAULT_CATEGORY_KEYS].map((key) => [key, key]));
const earnOn = (entryId: string, lines: SpendLine[]) => {
  const plan = planCatalogApply(findEntry(entryId)!, ids, '2026-09-11');
  const rules = plan.rules.map(({ catalogKey, ...rule }) => ({ ...rule, id: catalogKey }));
  const bonuses = plan.bonuses.map(({ catalogKey, ...bonus }) => ({ ...bonus, id: catalogKey }));
  return computeCycleEarn(lines, rules, {}, { bonuses, cycleEnd: '2026-09-25' });
};
let seq = 0;
const buy = (amountMinor: number, over: Partial<SpendLine> = {}): SpendLine => {
  seq += 1;
  return {
    transactionId: `t${seq}`, entryId: `e${seq}`, occurredOn: '2026-09-15', categoryId: 'food_beverage.restaurants', description: 'DIN TAI FUNG',
    amountMinor, currency: 'IDR', originalCurrency: null, mcc: '5812', mccSource: 'category', ...over,
  };
};

describe('catalogue data after the MCC addendum', () => {
  it('bundles twenty entries, each with a unique id', () => {
    expect(CATALOG).toHaveLength(20);
    expect(new Set(CATALOG.map((entry) => entry.id)).size).toBe(CATALOG.length);
  });

  it('adds Reward BCA MCC exclusions to both KrisFlyer terms periods', () => {
    for (const id of ['bca-sq-krisflyer-visa-signature', 'bca-sq-krisflyer-visa-infinite']) {
      const entry = findEntry(id)!;
      expect(entry.entryVersion, id).toBe(2);
      for (const period of entry.terms) {
        for (const match of [...period.rules, ...period.cycleBonuses].map((item) => item.match)) expect(match.excludeMccs, id).toContain('8398');
      }
    }
  });

  it('credits Mandiri World Prioritas and Maybank cards per purchase', () => {
    expect(findEntry('mandiri-world-prioritas')?.program.crediting).toBe('per_transaction');
    for (const id of ['maybank-visa-platinum', 'maybank-visa-infinite', 'maybank-bmw', 'maybank-mini', 'maybank-manchester-united']) {
      expect(findEntry(id)?.program.crediting, id).toBe('per_transaction');
    }
  });

  it('has at least 80 valid bundled merchants', () => {
    expect(validateMerchants(MERCHANTS)).toEqual([]);
    expect(MERCHANTS.merchants.length).toBeGreaterThanOrEqual(80);
  });
});

describe('Maybank TREATS golden numbers', () => {
  it('Visa Platinum dinner of Rp 60.000 at MCC 5812 earns 3 base plus 6 extra', () => {
    const earn = earnOn('maybank-visa-platinum', [buy(60_000)]);
    expect(earn.pointsByRule).toMatchObject({ 'start:base': 3, 'start:restaurants-supermarkets': 6 });
    expect(earn.totalPoints).toBe(9);
  });

  it('fast food at MCC 5814 earns nothing', () => {
    expect(earnOn('maybank-visa-platinum', [buy(60_000, { mcc: '5814', description: 'MCDONALD SENAYAN' })]).totalPoints).toBe(0);
  });

  it('utility payments above Rp 10.000.000 earn nothing, smaller ones earn the base rate', () => {
    const bill = (amountMinor: number) => buy(amountMinor, { mcc: '4900', categoryId: 'utilities.electricity', description: 'PLN PASCABAYAR' });
    expect(earnOn('maybank-visa-infinite', [bill(10_000_001)]).totalPoints).toBe(0);
    expect(earnOn('maybank-visa-infinite', [bill(1_000_000)]).totalPoints).toBe(112);
  });

  it('BMW dealer purchases earn 1 per Rp 3.333 and cap at 7.500 per cycle', () => {
    const dealer = (amountMinor: number) => buy(amountMinor, { mcc: '5511', categoryId: 'transport', description: 'BMW ASTRA CILANDAK' });
    expect(earnOn('maybank-bmw', [dealer(33_330)]).pointsByRule['start:dealer']).toBe(10);
    const big = earnOn('maybank-bmw', [dealer(30_000_000)]);
    expect(big.pointsByRule['start:dealer']).toBe(7500);
    expect(big.totalPoints).toBeGreaterThan(7500);
  });

  it('Manchester United shoe store purchase at MCC 5661 earns 1 plus 2 extra per Rp 20.000', () => {
    const earn = earnOn('maybank-manchester-united', [buy(20_000, { mcc: '5661', categoryId: 'shopping.clothing', description: 'SPORTS STATION' })]);
    expect(earn.totalPoints).toBe(3);
  });
});
