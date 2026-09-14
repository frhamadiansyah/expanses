import { findEntry } from '@expanses/catalog';
import { computeCycleEarn, convertPoints, expenseLines } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import {
  applyCatalogEntry,
  cardSpendLines,
  createAccount,
  listAccounts,
  listCycleBonuses,
  listEarnRules,
  listTransferPartners,
  postTransaction,
} from '../src/index';
import { setupDb } from './helpers';

const TODAY = '2026-09-14';
const FROM = '2026-09-01';
const TO = '2026-09-30';

async function withCard() {
  const t = await setupDb();
  const card = await createAccount(t.database, t.ws, { name: 'Danamon Amex Gold', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  const { programId } = await applyCatalogEntry(t.database, t.ws, {
    cardAccountId: card.id,
    entry: structuredClone(findEntry('danamon-amex-gold-credit-card')!),
    today: TODAY,
    replaceManual: false,
  });
  return { ...t, card, programId };
}

async function spend(t: Awaited<ReturnType<typeof withCard>>, amountMinor: number, category = 'shopping', description = 'Belanja') {
  const all = await listAccounts(t.database, t.ws);
  const categoryAccountId = all.find((a) => a.systemKey === category)!.id;
  await postTransaction(t.database, t.ws, {
    occurredOn: '2026-09-10',
    description,
    lines: expenseLines({ categoryAccountId, paymentAccountId: t.card.id, amountMinor, currency: 'IDR' }),
  });
}

async function earned(t: Awaited<ReturnType<typeof withCard>>) {
  const all = await listAccounts(t.database, t.ws);
  const ancestors = Object.fromEntries(all.map((a) => [a.id, a.parentId ? [a.parentId] : []]));
  const lines = await cardSpendLines(t.database, t.ws, t.card.id, FROM, TO);
  const rules = await listEarnRules(t.database, t.ws, t.programId);
  const bonuses = await listCycleBonuses(t.database, t.ws, t.programId);
  return computeCycleEarn(lines, rules, ancestors, { bonuses, cycleEnd: TO }).totalPoints;
}

describe('Danamon American Express Gold earning', () => {
  it('earns a Membership Rewards point per Rp 2.500', async () => {
    const t = await withCard();
    await spend(t, 1_000_000);
    expect(await earned(t)).toBe(400);
  });

  it('earns the same rate abroad and in every category, having no bonus of its own', async () => {
    const t = await withCard();
    for (const category of ['food_beverage.restaurants', 'travel', 'transportation.fuel_cost', 'utilities.electricity']) {
      await spend(t, 250_000, category);
    }
    expect(await earned(t)).toBe(400);
  });

  it('earns nothing on an insurance premium', async () => {
    const t = await withCard();
    await spend(t, 2_000_000, 'protection.health_insurance');
    expect(await earned(t)).toBe(0);
  });

  it('earns nothing on a cash advance or an instalment, which are recognised by description', async () => {
    const t = await withCard();
    await spend(t, 1_000_000, 'shopping', 'Tarik tunai ATM');
    await spend(t, 1_000_000, 'shopping', 'Belanja cicilan 12 bulan');
    expect(await earned(t)).toBe(0);
  });

  it('drops the remainder below one whole Rp 2.500', async () => {
    const t = await withCard();
    await spend(t, 6_000);
    expect(await earned(t)).toBe(2);
  });
});

describe('Danamon American Express Gold conversion', () => {
  it('offers only the two partners whose ratio could be pinned down', async () => {
    const t = await withCard();
    const partners = await listTransferPartners(t.database, t.ws, t.programId);
    expect(partners.map((p) => p.program)).toEqual(['KrisFlyer', 'Asia Miles']);
    // The other five the Frequent Traveller Option covers are named in the notes rather than guessed at.
    const notes = findEntry('danamon-amex-gold-credit-card')!.notes.join(' ');
    for (const program of ['GarudaMiles', 'AirAsia BIG points', 'Enrich', 'Marriott Bonvoy', 'Hilton Honors']) {
      expect(notes, program).toContain(program);
    }
  });

  it('takes 8 points for a KrisFlyer mile and 12 for an Asia Mile', async () => {
    const t = await withCard();
    const partners = await listTransferPartners(t.database, t.ws, t.programId);
    const at = (program: string, points: number) => convertPoints(points, partners.find((p) => p.program === program)!);
    expect(at('KrisFlyer', 8_000)).toBe(1_000);
    expect(at('Asia Miles', 12_000)).toBe(1_000);
  });

  it('says plainly that the ratios are derived and the transfer step is a placeholder', () => {
    const notes = findEntry('danamon-amex-gold-credit-card')!.notes;
    expect(notes.some((note) => note.includes('derived, not published'))).toBe(true);
    expect(notes.some((note) => note.includes('placeholder'))).toBe(true);
  });
});

describe('which Danamon Amex Gold this is', () => {
  it('is the Rp 350.000 credit card, and says the charge card is a different product', () => {
    const entry = findEntry('danamon-amex-gold-credit-card')!;
    expect(entry.fees[0]!.annualFeeMinor).toBe(350_000);
    expect(entry.notes[0]).toContain('Rp 1.200.000');
  });

  it('records that transferring at all needs the Frequent Traveller Option', () => {
    const entry = findEntry('danamon-amex-gold-credit-card')!;
    expect(entry.fees[0]!.condition).toContain('Rp 250.000 a year');
  });
});
