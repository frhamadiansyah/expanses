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
  saveCardTerms,
} from '../src/index';
import { setupDb } from './helpers';

const TODAY = '2026-09-15';
const FROM = '2026-09-01';
const TO = '2026-09-30';

const ADDED = [
  'maybank-jcb-platinum',
  'uob-tmrw',
  'permata-shopping-card',
  'permata-jcb-ultimate',
  'cimb-niaga-octo-card',
  'danamon-visa-platinum',
  'bni-tzu-chi',
  'bni-mypertamina',
  'dbs-live-fresh-visa',
];

async function withCard(entryId: string, memberLevel?: string) {
  const t = await setupDb();
  const card = await createAccount(t.database, t.ws, { name: 'Card', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  await saveCardTerms(t.database, t.ws, { accountId: card.id, statementDay: 25, dueDay: 12, creditLimitMinor: 50_000_000, annualFeeMinor: null });
  const { programId } = await applyCatalogEntry(t.database, t.ws, {
    cardAccountId: card.id,
    entry: structuredClone(findEntry(entryId)!),
    today: TODAY,
    replaceManual: false,
    memberLevel,
  });
  return { ...t, card, programId };
}

async function spend(t: Awaited<ReturnType<typeof withCard>>, amountMinor: number, opts: { category?: string; description?: string; mcc?: string } = {}) {
  const all = await listAccounts(t.database, t.ws);
  const categoryAccountId = all.find((a) => a.systemKey === (opts.category ?? 'shopping'))!.id;
  await postTransaction(t.database, t.ws, {
    occurredOn: '2026-09-10',
    description: opts.description ?? 'Belanja',
    mcc: opts.mcc,
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

describe('the cards added as a set', () => {
  it('are all in the catalogue, all credit cards, all on a statement cycle', () => {
    for (const id of ADDED) {
      const entry = findEntry(id);
      expect(entry, id).toBeDefined();
      expect(entry!.cardType ?? 'credit', id).toBe('credit');
      expect(entry!.program.cycleAnchor, id).toBe('statement');
      expect(entry!.sources.length, id).toBeGreaterThan(0);
    }
  });

  it('each earn something on the purchase the card is for', async () => {
    // Live Fresh earns on online spending alone, so it is the one card a plain shop purchase pays nothing on.
    const online = { description: 'Tokopedia' };
    for (const id of ADDED) {
      const levels = findEntry(id)!.program.memberLevels;
      const t = await withCard(id, levels?.[0]?.key);
      await spend(t, 1_000_000, id === 'dbs-live-fresh-visa' ? online : {});
      expect(await earned(t), id).toBeGreaterThan(0);
    }
  });
});

describe('DBS Live Fresh, which pays nothing unless you claim it', () => {
  it('pays 5% on online spending once the month is claimed', async () => {
    const t = await withCard('dbs-live-fresh-visa', 'claimed');
    await spend(t, 1_000_000, { description: 'Shopee belanja bulanan' });
    expect(await earned(t)).toBe(50_000);
  });

  it('pays nothing at all when the five transactions or the SMS are missed', async () => {
    const t = await withCard('dbs-live-fresh-visa', 'unclaimed');
    await spend(t, 1_000_000, { description: 'Shopee belanja bulanan' });
    expect(await earned(t)).toBe(0);
  });

  it('pays nothing offline either way, because the five offline purchases are a hurdle, not a rate', async () => {
    const t = await withCard('dbs-live-fresh-visa', 'claimed');
    await spend(t, 1_000_000, { category: 'household.groceries', description: 'Superindo Bintaro', mcc: '5411' });
    expect(await earned(t)).toBe(0);
  });

  it('stops at Rp 300.000 a month, the main card ceiling', async () => {
    const t = await withCard('dbs-live-fresh-visa', 'claimed');
    await spend(t, 20_000_000, { description: 'Tokopedia' });
    expect(await earned(t)).toBe(300_000);
  });
});

describe('Maybank JCB Platinum, the miles card of the range', () => {
  it('earns a point per Rp 10.000, twice what the Visa Platinum earns', async () => {
    const t = await withCard('maybank-jcb-platinum');
    await spend(t, 1_000_000);
    expect(await earned(t)).toBe(100);
    expect(findEntry('maybank-jcb-platinum')!.terms[0]!.rules.find((r) => r.key === 'base')!.rateDen).toBe(10_000);
    expect(findEntry('maybank-visa-platinum')!.terms[0]!.rules.find((r) => r.key === 'base')!.rateDen).toBe(20_000);
  });

  it('earns nothing on a utility bill above Rp 10.000.000, nor on a QR payment', async () => {
    const t = await withCard('maybank-jcb-platinum');
    await spend(t, 12_000_000, { category: 'utilities.electricity', mcc: '4900' });
    await spend(t, 1_000_000, { description: 'QRIS merchant' });
    expect(await earned(t)).toBe(0);
  });

  it('transfers one for one, on the shared TREATS ceiling', async () => {
    const t = await withCard('maybank-jcb-platinum');
    const partners = await listTransferPartners(t.database, t.ws, t.programId);
    expect(convertPoints(20_000, partners.find((p) => p.program === 'KrisFlyer')!)).toBe(20_000);
    // A mile costs Rp 10.000 here against Rp 20.000 on the Visa Platinum.
    expect(findEntry('maybank-jcb-platinum')!.terms[0]!.rules.find((r) => r.key === 'base')!.rateDen).toBe(10_000);
  });
});

describe('UOB TMRW, whose rate depends on what you did last month', () => {
  it('pays 6% in the chosen categories once the conditions are met', async () => {
    const t = await withCard('uob-tmrw', 'qualified');
    await spend(t, 1_000_000, { category: 'food_beverage.restaurants', mcc: '5812' });
    expect(await earned(t)).toBe(60_000);
  });

  it('pays 1% in the same categories when they are not', async () => {
    const t = await withCard('uob-tmrw', 'standard');
    await spend(t, 1_000_000, { category: 'food_beverage.restaurants', mcc: '5812' });
    expect(await earned(t)).toBe(10_000);
  });

  it('pays 0,2% outside them at either level', async () => {
    for (const level of ['qualified', 'standard']) {
      const t = await withCard('uob-tmrw', level);
      await spend(t, 1_000_000, { mcc: '5944' });
      expect(await earned(t), level).toBe(2_000);
    }
  });

  it('stops at Rp 200.000 a month', async () => {
    const t = await withCard('uob-tmrw', 'qualified');
    await spend(t, 20_000_000, { category: 'food_beverage.restaurants', mcc: '5812' });
    expect(await earned(t)).toBe(200_000);
  });
});

describe('the two Permata cards', () => {
  it('triples the Shopping Card at a supermarket, and not elsewhere', async () => {
    const t = await withCard('permata-shopping-card');
    await spend(t, 1_000_000, { category: 'household.groceries', mcc: '5411' });
    expect(await earned(t)).toBe(1_500);

    const other = await withCard('permata-shopping-card');
    await spend(other, 1_000_000, { mcc: '5944' });
    expect(await earned(other)).toBe(500);
  });

  it('halves the cost of a mile on the JCB Ultimate when eating out', async () => {
    const t = await withCard('permata-jcb-ultimate');
    await spend(t, 1_000_000, { category: 'food_beverage.restaurants', mcc: '5812' });
    expect(await earned(t)).toBe(200);

    const other = await withCard('permata-jcb-ultimate');
    await spend(other, 1_000_000);
    expect(await earned(other)).toBe(100);
  });

  it('transfers the Ultimate one for one to KrisFlyer', async () => {
    const t = await withCard('permata-jcb-ultimate');
    const partners = await listTransferPartners(t.database, t.ws, t.programId);
    expect(convertPoints(20_000, partners.find((p) => p.program === 'KrisFlyer')!)).toBe(20_000);
  });
});

describe('the three that earn a flat rate', () => {
  it('gives the OCTO Card 25 points a block of Rp 50.000, and charges nothing for it', async () => {
    const t = await withCard('cimb-niaga-octo-card');
    await spend(t, 1_000_000);
    expect(await earned(t)).toBe(500);
    // A part-block earns nothing, which is what "kelipatan Rp 50.000" means.
    const part = await withCard('cimb-niaga-octo-card');
    await spend(part, 49_999);
    expect(await earned(part)).toBe(0);
    expect(findEntry('cimb-niaga-octo-card')!.fees[0]!.annualFeeMinor).toBe(0);
  });

  it('gives the Danamon Visa Platinum the same D-Point rate and ratios as the JCB Precious', async () => {
    const t = await withCard('danamon-visa-platinum');
    await spend(t, 1_000_000);
    expect(await earned(t)).toBe(400);
    const partners = await listTransferPartners(t.database, t.ws, t.programId);
    expect(convertPoints(7_500, partners.find((p) => p.program === 'GarudaMiles')!)).toBe(500);
    expect(findEntry('danamon-visa-platinum')!.transferPartners).toEqual(findEntry('danamon-jcb-precious')!.transferPartners);
  });

  it('gives BNI Tzu Chi the ordinary BNI rate, its donation costing the holder nothing', async () => {
    const t = await withCard('bni-tzu-chi');
    await spend(t, 1_000_000);
    expect(await earned(t)).toBe(100);
    expect(findEntry('bni-tzu-chi')!.fees[0]!.annualFeeMinor).toBe(0);
  });
});

describe('BNI MyPertamina at the pump', () => {
  it('doubles only when the name and the fuel code agree', async () => {
    const t = await withCard('bni-mypertamina');
    await spend(t, 1_000_000, { category: 'transportation.fuel_cost', description: 'MyPertamina top up', mcc: '5541' });
    expect(await earned(t)).toBe(200);
  });

  it('falls back to the base rate at a filling station that is not Pertamina', async () => {
    const t = await withCard('bni-mypertamina');
    await spend(t, 1_000_000, { category: 'transportation.fuel_cost', description: 'Shell Kemang', mcc: '5541' });
    expect(await earned(t)).toBe(100);
  });
});
