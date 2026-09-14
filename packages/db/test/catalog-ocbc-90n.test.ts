import { findEntry } from '@expanses/catalog';
import { computeCycleEarn, type SpendLine } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { applyCatalogEntry, createAccount, listAccounts, listCycleBonuses, listEarnRules, saveCardTerms } from '../src/index';
import { setupDb } from './helpers';

const TODAY = '2026-09-14';

async function withCard(creditLimitMinor: number | null = 100_000_000) {
  const t = await setupDb();
  const card = await createAccount(t.database, t.ws, { name: 'OCBC 90N', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  if (creditLimitMinor !== null) {
    await saveCardTerms(t.database, t.ws, { accountId: card.id, statementDay: 25, dueDay: 12, creditLimitMinor, annualFeeMinor: null });
  }
  const { programId } = await applyCatalogEntry(t.database, t.ws, {
    cardAccountId: card.id,
    entry: structuredClone(findEntry('ocbc-90n')!),
    today: TODAY,
    replaceManual: false,
  });
  return { ...t, card, programId };
}

/** A purchase built straight as a spend line, so origin and category can be set exactly. */
let seq = 0;
const line = (categoryId: string, amountMinor: number, occurredOn: string, abroad = false): SpendLine => {
  seq += 1;
  const id = `t${seq}`;
  return {
    transactionId: id, entryId: `${id}e`, occurredOn, categoryId, description: 'buy', amountMinor,
    currency: 'IDR', originalCurrency: abroad ? 'SGD' : null, mcc: null, mccSource: null,
  };
};

async function earn(t: Awaited<ReturnType<typeof withCard>>, lines: SpendLine[], cycleEnd: string) {
  const all = await listAccounts(t.database, t.ws);
  const ancestors = Object.fromEntries(all.map((a) => [a.id, a.parentId ? [a.parentId] : []]));
  const rules = await listEarnRules(t.database, t.ws, t.programId);
  const bonuses = await listCycleBonuses(t.database, t.ws, t.programId);
  return computeCycleEarn(lines, rules, ancestors, { bonuses, cycleEnd }).totalPoints;
}

const idOf = async (t: Awaited<ReturnType<typeof withCard>>, key: string) =>
  (await listAccounts(t.database, t.ws)).find((a) => a.systemKey === key)!.id;

describe('OCBC 90°N earning', () => {
  it('earns a mile per Rp 12.000 at home', async () => {
    const t = await withCard();
    const shopping = await idOf(t, 'shopping');
    expect(await earn(t, [line(shopping, 120_000, '2026-09-10')], '2026-09-30')).toBe(10);
  });

  it('earns a mile per Rp 10.000 abroad', async () => {
    const t = await withCard();
    const shopping = await idOf(t, 'shopping');
    expect(await earn(t, [line(shopping, 120_000, '2026-09-10', true)], '2026-09-30')).toBe(12);
  });

  it('paid double abroad on dining before 13 February 2026', async () => {
    const t = await withCard();
    const dining = await idOf(t, 'food_beverage.restaurants');
    // Rp 120.000 abroad: 12 at the foreign rate plus 12 stacked, a mile per Rp 5.000.
    expect(await earn(t, [line(dining, 120_000, '2026-02-12', true)], '2026-02-28')).toBe(24);
  });

  it('stopped paying double on the same purchase from 13 February 2026', async () => {
    const t = await withCard();
    const dining = await idOf(t, 'food_beverage.restaurants');
    expect(await earn(t, [line(dining, 120_000, '2026-02-13', true)], '2026-02-28')).toBe(12);
  });

  it('never paid double on dining at home, only abroad', async () => {
    const t = await withCard();
    const dining = await idOf(t, 'food_beverage.restaurants');
    expect(await earn(t, [line(dining, 120_000, '2026-02-12')], '2026-02-28')).toBe(10);
  });

  it('paid 1.000 miles at Rp 60.000.000 a statement, and stopped after the change', async () => {
    const t = await withCard(500_000_000);
    const shopping = await idOf(t, 'shopping');
    const before = await earn(t, [line(shopping, 60_000_000, '2026-02-10')], '2026-02-12');
    const after = await earn(t, [line(shopping, 60_000_000, '2026-03-10')], '2026-03-31');
    expect(before).toBe(5_000 + 1_000);
    expect(after).toBe(5_000);
  });

  it('earns nothing on school fees or petrol, which stopped earning', async () => {
    const t = await withCard();
    const tuition = await idOf(t, 'education.tuition_fees');
    const fuel = await idOf(t, 'transportation.fuel_cost');
    expect(await earn(t, [line(tuition, 5_000_000, '2026-09-10'), line(fuel, 1_000_000, '2026-09-10')], '2026-09-30')).toBe(0);
  });

  it('caps earning at one times the card limit a month', async () => {
    const t = await withCard(10_000_000);
    for (const rule of await listEarnRules(t.database, t.ws, t.programId)) {
      expect(rule.capSpendMinor, rule.name).toBe(10_000_000);
    }
    const shopping = await idOf(t, 'shopping');
    // Rp 24.000.000 spent, only Rp 10.000.000 rewarded: 833 whole increments of Rp 12.000.
    expect(await earn(t, [line(shopping, 24_000_000, '2026-09-10')], '2026-09-30')).toBe(833);
  });
});

describe('OCBC 90°N conversion', () => {
  it('converts one for one to KrisFlyer and a little better to GarudaMiles', async () => {
    const partners = Object.fromEntries(findEntry('ocbc-90n')!.transferPartners.map((p) => [p.key, [p.points, p.partnerUnits]]));
    expect(partners['krisflyer']).toEqual([1000, 1000]);
    expect(partners['garudamiles']).toEqual([1000, 1050]);
  });

  it('gives Asia Miles a quarter less than KrisFlyer, and BA and Etihad a tenth less', async () => {
    const partners = Object.fromEntries(findEntry('ocbc-90n')!.transferPartners.map((p) => [p.key, p.partnerUnits]));
    expect(partners['asia-miles']).toBe(750);
    expect(partners['british-airways']).toBe(900);
    expect(partners['etihad']).toBe(900);
  });
});
