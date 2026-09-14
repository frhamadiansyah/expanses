import { findEntry } from '@expanses/catalog';
import { computeCycleEarn, type SpendLine } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { applyCatalogEntry, createAccount, listAccounts, listCycleBonuses, listEarnRules } from '../src/index';
import { setupDb } from './helpers';

const TODAY = '2026-09-14';
const NEW = '2026-09-10';
const OLD = '2026-03-09';

async function withCard() {
  const t = await setupDb();
  const card = await createAccount(t.database, t.ws, { name: 'UOB Garuda', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  const { programId } = await applyCatalogEntry(t.database, t.ws, {
    cardAccountId: card.id, entry: structuredClone(findEntry('uob-garuda-indonesia')!), today: TODAY, replaceManual: false,
  });
  return { ...t, card, programId };
}

let seq = 0;
type Opts = { description?: string; mcc?: string; abroad?: boolean };
const line = (categoryId: string, amountMinor: number, occurredOn: string, o: Opts = {}): SpendLine => {
  seq += 1;
  const id = `ug${seq}`;
  return {
    transactionId: id, entryId: `${id}e`, occurredOn, categoryId, description: o.description ?? 'shop', amountMinor,
    currency: 'IDR', originalCurrency: o.abroad ? 'SGD' : null, mcc: o.mcc ?? null, mccSource: o.mcc ? 'typed' : null,
  };
};

async function earn(t: Awaited<ReturnType<typeof withCard>>, category: string, amountMinor: number, occurredOn: string, o: Opts = {}) {
  const all = await listAccounts(t.database, t.ws);
  const ancestors = Object.fromEntries(all.map((a) => [a.id, a.parentId ? [a.parentId] : []]));
  const categoryId = all.find((a) => a.systemKey === category)!.id;
  const rules = await listEarnRules(t.database, t.ws, t.programId);
  const bonuses = await listCycleBonuses(t.database, t.ws, t.programId);
  const cycleEnd = occurredOn.slice(0, 8) + '28';
  return computeCycleEarn([line(categoryId, amountMinor, occurredOn, o)], rules, ancestors, { bonuses, cycleEnd }).totalPoints;
}

describe('Garuda Indonesia UOB Card, from 10 March 2026', () => {
  it('pays a mile per Rp 5.000 at Garuda, found by the name on the line', async () => {
    const t = await withCard();
    expect(await earn(t, 'travel.flights', 1_000_000, NEW, { description: 'GARUDA INDONESIA' })).toBe(200);
  });

  it('finds Garuda by its merchant category code too, when the line says nothing', async () => {
    const t = await withCard();
    expect(await earn(t, 'travel.flights', 1_000_000, NEW, { mcc: '3103' })).toBe(200);
  });

  it('pays a mile per Rp 8.000 on other travel and on foreign spend', async () => {
    const t = await withCard();
    expect(await earn(t, 'travel.hotels', 800_000, NEW)).toBe(100);
    expect(await earn(t, 'shopping', 800_000, NEW, { abroad: true })).toBe(100);
  });

  it('pays a mile per Rp 12.000 on everything else', async () => {
    const t = await withCard();
    expect(await earn(t, 'shopping', 1_200_000, NEW)).toBe(100);
  });

  it('gives Garuda the best of the three when a purchase could match several', async () => {
    const t = await withCard();
    // A Garuda ticket bought abroad matches Garuda, travel and foreign; the Rp 5.000 rate wins.
    expect(await earn(t, 'travel.flights', 1_000_000, NEW, { description: 'GARUDA INDONESIA', abroad: true })).toBe(200);
  });
});

describe('Garuda Indonesia UOB Card, before the change', () => {
  it('paid 3 miles per Rp 20.000 at Garuda, the exact form of Rp 6.666 a mile', async () => {
    const t = await withCard();
    expect(await earn(t, 'travel.flights', 20_000, OLD, { description: 'GARUDA INDONESIA' })).toBe(3);
  });

  it('paid a mile per Rp 10.000 on everything else, and had no travel tier', async () => {
    const t = await withCard();
    expect(await earn(t, 'shopping', 1_000_000, OLD)).toBe(100);
    // A hotel earned the ordinary rate before the travel tier existed.
    expect(await earn(t, 'travel.hotels', 1_000_000, OLD)).toBe(100);
  });

  it('improved at Garuda and worsened elsewhere on the same spend', async () => {
    const t = await withCard();
    const garudaBefore = await earn(t, 'travel.flights', 1_000_000, OLD, { description: 'GARUDA INDONESIA' });
    const garudaAfter = await earn(t, 'travel.flights', 1_000_000, NEW, { description: 'GARUDA INDONESIA' });
    const otherBefore = await earn(t, 'shopping', 1_200_000, OLD);
    const otherAfter = await earn(t, 'shopping', 1_200_000, NEW);
    expect(garudaAfter).toBeGreaterThan(garudaBefore);
    expect(otherAfter).toBeLessThan(otherBefore);
  });
});
