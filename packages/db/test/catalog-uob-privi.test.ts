import { findEntry } from '@expanses/catalog';
import { computeCycleEarn, convertPoints, type SpendLine } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { applyCatalogEntry, createAccount, listAccounts, listCycleBonuses, listEarnRules, listTransferPartners } from '../src/index';
import { setupDb } from './helpers';

const TODAY = '2026-09-14';

async function withCard() {
  const t = await setupDb();
  const card = await createAccount(t.database, t.ws, { name: 'UOB PRIVI', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  const { programId } = await applyCatalogEntry(t.database, t.ws, {
    cardAccountId: card.id, entry: structuredClone(findEntry('uob-privi-miles')!), today: TODAY, replaceManual: false,
  });
  return { ...t, card, programId };
}

let seq = 0;
const line = (categoryId: string, amountMinor: number, abroad = false): SpendLine => {
  seq += 1;
  const id = `u${seq}`;
  return { transactionId: id, entryId: `${id}e`, occurredOn: '2026-09-10', categoryId, description: 'buy', amountMinor,
    currency: 'IDR', originalCurrency: abroad ? 'SGD' : null, mcc: null, mccSource: null };
};

async function earn(t: Awaited<ReturnType<typeof withCard>>, amountMinor: number, abroad = false) {
  const all = await listAccounts(t.database, t.ws);
  const ancestors = Object.fromEntries(all.map((a) => [a.id, a.parentId ? [a.parentId] : []]));
  const shopping = all.find((a) => a.systemKey === 'shopping')!.id;
  const rules = await listEarnRules(t.database, t.ws, t.programId);
  const bonuses = await listCycleBonuses(t.database, t.ws, t.programId);
  return computeCycleEarn([line(shopping, amountMinor, abroad)], rules, ancestors, { bonuses, cycleEnd: '2026-09-30' }).totalPoints;
}

describe('UOB PRIVI Miles', () => {
  it('earns a UOB Mile per Rp 1.000 at home and per Rp 500 abroad', async () => {
    const t = await withCard();
    expect(await earn(t, 100_000)).toBe(100);
    expect(await earn(t, 100_000, true)).toBe(200);
  });

  it('takes 12 UOB Miles for an airline mile today, and took 10 before 9 January 2026', async () => {
    const t = await withCard();
    const partners = await listTransferPartners(t.database, t.ws, t.programId);
    const kf = partners.filter((p) => p.program === 'KrisFlyer');
    expect(kf.map((p) => [p.points, p.validFrom, p.validTo])).toEqual([
      [10, null, '2026-01-08'],
      [12, '2026-01-09', null],
    ]);
  });

  it('so Rp 120.000 of domestic spend is 10 airline miles now and 12 before', async () => {
    const t = await withCard();
    const partners = await listTransferPartners(t.database, t.ws, t.programId);
    const now = partners.find((p) => p.program === 'KrisFlyer' && p.validTo === null)!;
    const before = partners.find((p) => p.program === 'KrisFlyer' && p.validTo !== null)!;
    expect(convertPoints(120, now)).toBe(10);
    expect(convertPoints(120, before)).toBe(12);
  });

  it('converts the same way to GarudaMiles and Asia Miles', async () => {
    const t = await withCard();
    const partners = await listTransferPartners(t.database, t.ws, t.programId);
    const current = partners.filter((p) => p.validTo === null);
    expect(current.map((p) => p.program).sort()).toEqual(['Asia Miles', 'GarudaMiles', 'KrisFlyer']);
    for (const p of current) expect([p.points, p.partnerUnits], p.program).toEqual([12, 1]);
  });

  it('earns the same on every category, since nothing is published as excluded', async () => {
    const t = await withCard();
    const rules = await listEarnRules(t.database, t.ws, t.programId);
    for (const rule of rules) expect(rule.match.excludeCategoryIds ?? []).toEqual([]);
  });
});
