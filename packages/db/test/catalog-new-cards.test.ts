import { findEntry } from '@expanses/catalog';
import { computeCycleEarn, convertPoints, partnerFor, type SpendLine } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { applyCatalogEntry, createAccount, listAccounts, listCycleBonuses, listEarnRules, listTransferPartners, saveCardTerms } from '../src/index';
import { setupDb } from './helpers';

const TODAY = '2026-09-15';

async function withCard(entryId: string, creditLimitMinor: number | null = null) {
  const t = await setupDb();
  const card = await createAccount(t.database, t.ws, { name: entryId, kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  if (creditLimitMinor !== null) {
    await saveCardTerms(t.database, t.ws, { accountId: card.id, statementDay: 25, dueDay: 12, creditLimitMinor, annualFeeMinor: null });
  }
  const { programId } = await applyCatalogEntry(t.database, t.ws, {
    cardAccountId: card.id, entry: structuredClone(findEntry(entryId)!), today: TODAY, replaceManual: false,
  });
  return { ...t, card, programId };
}

let seq = 0;
const line = (categoryId: string, amountMinor: number, over: Partial<SpendLine> = {}): SpendLine => {
  seq += 1;
  return {
    transactionId: `n${seq}`, entryId: `n${seq}e`, occurredOn: '2026-09-10', categoryId, description: 'buy',
    amountMinor, currency: 'IDR', originalCurrency: null, mcc: null, mccSource: null, ...over,
  };
};

async function earn(t: Awaited<ReturnType<typeof withCard>>, lines: SpendLine[], cycleEnd = '2026-09-30') {
  const all = await listAccounts(t.database, t.ws);
  const ancestors = Object.fromEntries(all.map((a) => [a.id, a.parentId ? [a.parentId] : []]));
  const rules = await listEarnRules(t.database, t.ws, t.programId);
  const bonuses = await listCycleBonuses(t.database, t.ws, t.programId);
  return computeCycleEarn(lines, rules, ancestors, { bonuses, cycleEnd }).totalPoints;
}

const idOf = async (t: Awaited<ReturnType<typeof withCard>>, key: string) =>
  (await listAccounts(t.database, t.ws)).find((a) => a.systemKey === key)!.id;

describe('digibank Visa Travel Signature', () => {
  it('earns a mile per Rp 9.000 at home and per Rp 6.000 abroad', async () => {
    const t = await withCard('dbs-travel-visa-signature');
    const shopping = await idOf(t, 'shopping');
    expect(await earn(t, [line(shopping, 900_000)])).toBe(100);
    expect(await earn(t, [line(shopping, 900_000, { originalCurrency: 'SGD' })])).toBe(150);
  });

  it('converts one for one, in blocks of 5.000 miles', async () => {
    const t = await withCard('dbs-travel-visa-signature');
    const partners = await listTransferPartners(t.database, t.ws, t.programId);
    expect(partners.map((p) => p.program).sort()).toEqual(['Asia Miles', 'GarudaMiles', 'KrisFlyer']);
    for (const partner of partners) {
      expect(convertPoints(4_999, partner), partner.program).toBe(0);
      expect(convertPoints(12_000, partner), partner.program).toBe(10_000);
    }
  });
});

describe('DBS Vantage Visa Infinite', () => {
  it('earns a mile per Rp 7.500, at one rate whether at home or abroad', async () => {
    const t = await withCard('dbs-vantage-visa-infinite');
    const shopping = await idOf(t, 'shopping');
    expect(await earn(t, [line(shopping, 750_000)])).toBe(100);
    expect(await earn(t, [line(shopping, 750_000, { originalCurrency: 'SGD' })])).toBe(100);
  });

  it('stops earning past one times the card limit', async () => {
    const t = await withCard('dbs-vantage-visa-infinite', 10_000_000);
    const shopping = await idOf(t, 'shopping');
    expect((await listEarnRules(t.database, t.ws, t.programId))[0]!.capSpendMinor).toBe(10_000_000);
    // Rp 30.000.000 spent, only Rp 10.000.000 rewarded.
    expect(await earn(t, [line(shopping, 30_000_000)])).toBe(1_333);
  });

  it('runs uncapped when no limit is recorded, which overstates a large month', async () => {
    const t = await withCard('dbs-vantage-visa-infinite');
    expect((await listEarnRules(t.database, t.ws, t.programId))[0]!.capSpendMinor).toBeNull();
  });

  it('costs more a year than any other card here, and cannot be spent off', () => {
    const fee = findEntry('dbs-vantage-visa-infinite')!.fees[0]!;
    expect(fee.annualFeeMinor).toBe(5_000_000);
    expect(fee.condition).toContain('cannot be waived by spending');
  });
});

describe('CIMB Niaga World Cathay', () => {
  it('pays nearly four times as much at Cathay as anywhere else', async () => {
    const t = await withCard('cimb-niaga-world-cathay');
    const travel = await idOf(t, 'travel');
    // Rp 500.000: 150 miles at Cathay, 40 elsewhere.
    expect(await earn(t, [line(travel, 500_000, { description: 'CATHAY PACIFIC AIRWAYS' })])).toBe(150);
    expect(await earn(t, [line(travel, 500_000, { description: 'GARUDA INDONESIA' })])).toBe(40);
  });

  it('earns Asia Miles directly, so there is nothing to transfer', async () => {
    const t = await withCard('cimb-niaga-world-cathay');
    expect(findEntry('cimb-niaga-world-cathay')!.program.name).toBe('Asia Miles');
    expect(await listTransferPartners(t.database, t.ws, t.programId)).toEqual([]);
  });

  it('earns nothing before the card existed', async () => {
    const t = await withCard('cimb-niaga-world-cathay');
    const travel = await idOf(t, 'travel');
    expect(await earn(t, [line(travel, 500_000, { occurredOn: '2025-07-30' })], '2025-07-31')).toBe(0);
    expect(await earn(t, [line(travel, 500_000, { occurredOn: '2025-07-31' })], '2025-07-31')).toBe(40);
  });
});

describe('UOB Zenith', () => {
  it('earns a point per Rp 1.500, unchanged by the January 2026 devaluation', async () => {
    const t = await withCard('uob-zenith');
    const shopping = await idOf(t, 'shopping');
    for (const occurredOn of ['2025-12-10', '2026-09-10']) {
      expect(await earn(t, [line(shopping, 1_500_000, { occurredOn })], '2026-09-30'), occurredOn).toBe(1_000);
    }
  });

  it('cut the conversion instead: 5 points a mile became 5,87', async () => {
    const t = await withCard('uob-zenith');
    const partners = await listTransferPartners(t.database, t.ws, t.programId);
    const before = partnerFor(partners, 'KrisFlyer', '2026-01-08')!;
    const after = partnerFor(partners, 'KrisFlyer', '2026-01-09')!;
    expect([before.points, before.partnerUnits]).toEqual([5, 1]);
    expect([after.points, after.partnerUnits]).toEqual([587, 100]);
    // The same 58.700 points buy 11.740 miles before the change and 10.000 after.
    expect(convertPoints(58_700, before)).toBe(11_740);
    expect(convertPoints(58_700, after)).toBe(10_000);
  });

  it('works out at Rp 7.500 a mile before and Rp 8.800 after', () => {
    const perMile = (points: number, units: number) => Math.round((1_500 * points) / units / 100) * 100;
    expect(perMile(5, 1)).toBe(7_500);
    expect(perMile(587, 100)).toBe(8_800);
  });
});

describe('BCA American Express Platinum', () => {
  it('earns 5 points per Rp 1.000', async () => {
    const t = await withCard('bca-amex-platinum');
    const shopping = await idOf(t, 'shopping');
    expect(await earn(t, [line(shopping, 1_000_000)])).toBe(5_000);
  });

  it('needs 37,5 points a mile, so 750.000 points buy 20.000', async () => {
    const t = await withCard('bca-amex-platinum');
    const krisflyer = (await listTransferPartners(t.database, t.ws, t.programId)).find((p) => p.program === 'KrisFlyer')!;
    expect([krisflyer.points, krisflyer.partnerUnits]).toEqual([75, 2]);
    expect(convertPoints(750_000, krisflyer)).toBe(20_000);
  });

  it('agrees with the Rp 7.500 a mile the two published figures imply', async () => {
    const t = await withCard('bca-amex-platinum');
    const shopping = await idOf(t, 'shopping');
    const krisflyer = (await listTransferPartners(t.database, t.ws, t.programId)).find((p) => p.program === 'KrisFlyer')!;
    // Rp 150.000.000 earns 750.000 points, which buy 20.000 miles: Rp 7.500 each.
    const points = await earn(t, [line(shopping, 150_000_000)]);
    expect(points).toBe(750_000);
    expect(150_000_000 / convertPoints(points, krisflyer)).toBe(7_500);
  });

  it('values a point at Rp 1 as cashback, so converting can be compared against spending', () => {
    expect(findEntry('bca-amex-platinum')!.cashValue).toEqual({ valueMinor: 1, perPoints: 1, currency: 'IDR' });
  });
});

describe('all five new entries', () => {
  const IDS = ['dbs-travel-visa-signature', 'dbs-vantage-visa-infinite', 'cimb-niaga-world-cathay', 'uob-zenith', 'bca-amex-platinum'];

  it('carry a drawn face and say plainly that no source could be read', () => {
    for (const id of IDS) {
      const entry = findEntry(id)!;
      expect(entry.look, id).toBeDefined();
      expect(entry.notes.some((n) => n.includes('No source could be read directly')), id).toBe(true);
    }
  });

  it('round every rate the same way, on whole increments', () => {
    for (const id of IDS) {
      for (const period of findEntry(id)!.terms) {
        for (const rule of period.rules) expect(rule.rounding, `${id}/${rule.key}`).toBe('per_increment');
      }
    }
  });
});
