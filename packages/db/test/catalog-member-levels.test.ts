import { type CatalogEntry, findEntry } from '@expanses/catalog';
import { describe, expect, it } from 'vitest';
import {
  applyCatalogEntry,
  CatalogError,
  createAccount,
  getCatalogState,
  listEarnRules,
  listTransferPartners,
  setCatalogMemberLevel,
  syncLinkedPrograms,
} from '../src/index';
import { setupDb } from './helpers';

const TODAY = '2026-09-13';

/** A real bundled entry, given two levels: the base rate and the transfer ratio both follow the holder's standing. */
function tiered(): CatalogEntry {
  const base = structuredClone(findEntry('bca-unionpay')!);
  return {
    ...base,
    id: 'tiered-test-card',
    program: {
      ...base.program,
      memberLevels: [
        { key: 'high', name: 'High', condition: 'average balance Rp 10.000.000 or more' },
        { key: 'low', name: 'Low', condition: 'average balance below Rp 10.000.000' },
      ],
    },
    terms: [
      {
        effectiveFrom: null,
        effectiveTo: null,
        rules: [
          { key: 'base-high', name: 'Base, High', rateNum: 1, rateDen: 10_000, rounding: 'per_increment', priority: 0, stackable: false, match: {}, memberLevels: ['high'] },
          { key: 'base-low', name: 'Base, Low', rateNum: 1, rateDen: 20_000, rounding: 'per_increment', priority: 0, stackable: false, match: {}, memberLevels: ['low'] },
          { key: 'dining', name: 'Restaurants', rateNum: 1, rateDen: 10_000, rounding: 'per_increment', priority: 0, stackable: true, match: { mccs: ['5812'] } },
        ],
        cycleBonuses: [],
      },
    ],
    transferPartners: [
      { key: 'krisflyer-high', program: 'KrisFlyer', points: 40_000, partnerUnits: 40_000, incrementPoints: 40_000, effectiveFrom: null, effectiveTo: null, memberLevels: ['high'] },
      { key: 'krisflyer-low', program: 'KrisFlyer', points: 50_000, partnerUnits: 40_000, incrementPoints: 50_000, effectiveFrom: null, effectiveTo: null, memberLevels: ['low'] },
    ],
  };
}

async function withCard() {
  const t = await setupDb();
  const card = await createAccount(t.database, t.ws, { name: 'Tiered Card', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  return { ...t, card };
}

const ruleNames = async (t: Awaited<ReturnType<typeof withCard>>, programId: string) =>
  (await listEarnRules(t.database, t.ws, programId)).map((rule) => rule.name).sort();

describe('applying a card that earns by member level', () => {
  it('refuses to apply without a level, since the card would earn nothing at base', async () => {
    const t = await withCard();
    await expect(applyCatalogEntry(t.database, t.ws, { cardAccountId: t.card.id, entry: tiered(), today: TODAY, replaceManual: false })).rejects.toBeInstanceOf(CatalogError);
  });

  it('refuses a level the entry does not publish', async () => {
    const t = await withCard();
    await expect(
      applyCatalogEntry(t.database, t.ws, { cardAccountId: t.card.id, entry: tiered(), today: TODAY, replaceManual: false, memberLevel: 'platinum' }),
    ).rejects.toBeInstanceOf(CatalogError);
  });

  it('writes only the chosen level’s base rule, and the rules that apply at every level', async () => {
    const t = await withCard();
    const { programId } = await applyCatalogEntry(t.database, t.ws, { cardAccountId: t.card.id, entry: tiered(), today: TODAY, replaceManual: false, memberLevel: 'low' });
    expect(await ruleNames(t, programId)).toEqual(['Base, Low', 'Restaurants']);
    const rules = await listEarnRules(t.database, t.ws, programId);
    expect(rules.find((rule) => rule.name === 'Base, Low')!.rateDen).toBe(20_000);
  });

  it('writes only the chosen level’s transfer ratio', async () => {
    const t = await withCard();
    const { programId } = await applyCatalogEntry(t.database, t.ws, { cardAccountId: t.card.id, entry: tiered(), today: TODAY, replaceManual: false, memberLevel: 'high' });
    const partners = await listTransferPartners(t.database, t.ws, programId);
    expect(partners.map((partner) => partner.points)).toEqual([40_000]);
  });

  it('records the level on the program', async () => {
    const t = await withCard();
    const { programId } = await applyCatalogEntry(t.database, t.ws, { cardAccountId: t.card.id, entry: tiered(), today: TODAY, replaceManual: false, memberLevel: 'high' });
    expect((await getCatalogState(t.database, t.ws, programId)).memberLevel).toBe('high');
  });

  it('leaves the level null for a card that publishes none', async () => {
    const t = await withCard();
    const flat = structuredClone(findEntry('bca-unionpay')!);
    const { programId } = await applyCatalogEntry(t.database, t.ws, { cardAccountId: t.card.id, entry: flat, today: TODAY, replaceManual: false });
    expect((await getCatalogState(t.database, t.ws, programId)).memberLevel).toBeNull();
  });
});

describe('the holder’s standing changes', () => {
  it('moves the base rate and the transfer ratio to the new level', async () => {
    const t = await withCard();
    const { programId } = await applyCatalogEntry(t.database, t.ws, { cardAccountId: t.card.id, entry: tiered(), today: TODAY, replaceManual: false, memberLevel: 'high' });

    await setCatalogMemberLevel(t.database, t.ws, programId, 'low', TODAY);

    expect(await ruleNames(t, programId)).toEqual(['Base, Low', 'Restaurants']);
    expect((await listTransferPartners(t.database, t.ws, programId)).map((partner) => partner.points)).toEqual([50_000]);
    expect((await getCatalogState(t.database, t.ws, programId)).memberLevel).toBe('low');
  });

  it('refuses a level the entry does not publish', async () => {
    const t = await withCard();
    const { programId } = await applyCatalogEntry(t.database, t.ws, { cardAccountId: t.card.id, entry: tiered(), today: TODAY, replaceManual: false, memberLevel: 'high' });
    await expect(setCatalogMemberLevel(t.database, t.ws, programId, 'platinum', TODAY)).rejects.toBeInstanceOf(CatalogError);
  });
});

describe('syncing a newer entry', () => {
  it('keeps the level the holder is on: their standing is not catalogue data', async () => {
    const t = await withCard();
    const { programId } = await applyCatalogEntry(t.database, t.ws, { cardAccountId: t.card.id, entry: tiered(), today: TODAY, replaceManual: false, memberLevel: 'low' });

    const v2 = tiered();
    v2.entryVersion = tiered().entryVersion + 1;
    v2.terms[0]!.rules[1]!.rateDen = 25_000; // the low level is devalued
    const synced = await syncLinkedPrograms(t.database, t.ws, [v2], TODAY);

    expect(synced).toEqual([programId]);
    const state = await getCatalogState(t.database, t.ws, programId);
    expect(state.memberLevel).toBe('low');
    const rules = await listEarnRules(t.database, t.ws, programId);
    expect(rules.find((rule) => rule.name === 'Base, Low')!.rateDen).toBe(25_000);
    expect(rules.some((rule) => rule.name === 'Base, High')).toBe(false);
  });
});
