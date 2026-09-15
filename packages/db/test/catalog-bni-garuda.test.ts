import { findEntry } from '@expanses/catalog';
import { computeCycleEarn, type SpendLine } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { applyCatalogEntry, createAccount, listAccounts, listCycleBonuses, listEarnRules } from '../src/index';
import { setupDb } from './helpers';

const TODAY = '2026-09-14';

async function withCard(entryId: string) {
  const t = await setupDb();
  const card = await createAccount(t.database, t.ws, { name: 'BNI Garuda', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  const { programId } = await applyCatalogEntry(t.database, t.ws, {
    cardAccountId: card.id,
    entry: structuredClone(findEntry(entryId)!),
    today: TODAY,
    replaceManual: false,
  });
  return { ...t, card, programId };
}

let seq = 0;
const line = (categoryId: string, amountMinor: number, occurredOn: string): SpendLine => {
  seq += 1;
  const id = `g${seq}`;
  return {
    transactionId: id, entryId: `${id}e`, occurredOn, categoryId, description: 'buy', amountMinor,
    currency: 'IDR', originalCurrency: null, mcc: null, mccSource: null,
  };
};

async function earn(t: Awaited<ReturnType<typeof withCard>>, amountMinor: number, occurredOn: string, cycleEnd: string) {
  const all = await listAccounts(t.database, t.ws);
  const ancestors = Object.fromEntries(all.map((a) => [a.id, a.parentId ? [a.parentId] : []]));
  const shopping = all.find((a) => a.systemKey === 'shopping')!.id;
  const rules = await listEarnRules(t.database, t.ws, t.programId);
  const bonuses = await listCycleBonuses(t.database, t.ws, t.programId);
  return computeCycleEarn([line(shopping, amountMinor, occurredOn)], rules, ancestors, { bonuses, cycleEnd }).totalPoints;
}

describe('BNI Garuda Indonesia Visa Signature', () => {
  it('earns a mile per Rp 12.000 from 26 February 2026', async () => {
    const t = await withCard('bni-garuda-visa-signature');
    expect(await earn(t, 1_200_000, '2026-09-10', '2026-09-30')).toBe(100);
  });

  it('earned a mile per Rp 10.000 before that date, so an older cycle keeps its rate', async () => {
    const t = await withCard('bni-garuda-visa-signature');
    expect(await earn(t, 1_200_000, '2026-02-25', '2026-02-28')).toBe(120);
  });

  it('changes on the 26th, not the 25th', async () => {
    const t = await withCard('bni-garuda-visa-signature');
    expect(await earn(t, 120_000, '2026-02-25', '2026-02-28')).toBe(12);
    expect(await earn(t, 120_000, '2026-02-26', '2026-02-28')).toBe(10);
  });
});

describe('the BNI Garuda Signature', () => {
  it('keeps both rates, one on each side of the change', () => {
    expect(findEntry('bni-garuda-visa-signature')!.terms).toHaveLength(2);
  });

  it('earns GarudaMiles directly, so there is nothing to transfer', () => {
    const entry = findEntry('bni-garuda-visa-signature')!;
    expect(entry.program.name).toBe('GarudaMiles');
    expect(entry.program.unit).toBe('miles');
    expect(entry.transferPartners).toEqual([]);
  });

  it('charges Rp 800.000 a year', () => {
    expect(findEntry('bni-garuda-visa-signature')!.fees[0]!.annualFeeMinor).toBe(800_000);
  });
});
