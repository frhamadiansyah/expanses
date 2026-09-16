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

async function spend(t: Awaited<ReturnType<typeof withCard>>, amountMinor: number, opts: { category?: string; description?: string; mcc?: string; on?: string } = {}) {
  const all = await listAccounts(t.database, t.ws);
  const categoryAccountId = all.find((a) => a.systemKey === (opts.category ?? 'shopping'))!.id;
  await postTransaction(t.database, t.ws, {
    occurredOn: opts.on ?? '2026-09-10',
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
  it('are all in the catalogue, all credit cards, all sourced', () => {
    for (const id of ADDED) {
      const entry = findEntry(id);
      expect(entry, id).toBeDefined();
      expect(entry!.cardType ?? 'credit', id).toBe('credit');
      expect(entry!.sources.length, id).toBeGreaterThan(0);
    }
  });

  it('count their cycles the way each issuer writes the cap', () => {
    // Danamon caps its cashback "per bulan", so its cycle is the calendar month rather than the statement.
    for (const id of ADDED) {
      const expected = id === 'danamon-visa-platinum' ? 'calendar' : 'statement';
      expect(findEntry(id)!.program.cycleAnchor, id).toBe(expected);
    }
  });

  it('each earn something on the purchase the card is for', async () => {
    // Four cards earn on one kind of purchase only, so each gets the purchase its own rules are written for.
    const only: Record<string, Parameters<typeof spend>[2]> = {
      'dbs-live-fresh-visa': { description: 'Tokopedia' },
      'permata-shopping-card': { description: 'Tokopedia' },
      'cimb-niaga-octo-card': { description: 'QRIS Warung Tegal' },
      'danamon-visa-platinum': { on: '2026-09-19' },  // a Saturday; the five-purchase gate is handled below
      'bni-mypertamina': { category: 'transportation.fuel_cost', description: 'MyPertamina top up', mcc: '5541' },
    };
    for (const id of ADDED) {
      const levels = findEntry(id)!.program.memberLevels;
      const t = await withCard(id, levels?.[0]?.key);
      // The Shopping Card needs Rp 5.000.000 in the cycle and the Danamon five purchases of Rp 100.000, so
      // every card is given six purchases of Rp 1.000.000, which satisfies both.
      for (let i = 0; i < 6; i += 1) await spend(t, 1_000_000, only[id] ?? {});
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
  it('pays the Shopping Card 5% online and 5% elsewhere, on separate ceilings', async () => {
    const t = await withCard('permata-shopping-card');
    await spend(t, 6_000_000, { description: 'Tokopedia' });
    expect(await earned(t)).toBe(200_000);

    const offline = await withCard('permata-shopping-card');
    await spend(offline, 6_000_000, { category: 'household.groceries', description: 'Superindo', mcc: '5411' });
    expect(await earned(offline)).toBe(100_000);
  });

  it('pays the Shopping Card nothing below the cycle floor', async () => {
    const t = await withCard('permata-shopping-card');
    await spend(t, 4_999_999, { description: 'Tokopedia' });
    expect(await earned(t)).toBe(0);
  });

  it('counts the Shopping Card floor across online and offline together, as the bank does', async () => {
    const t = await withCard('permata-shopping-card');
    await spend(t, 3_000_000, { description: 'Tokopedia' });
    await spend(t, 3_000_000, { category: 'household.groceries', description: 'Superindo', mcc: '5411' });
    // Neither half reaches Rp 5.000.000 on its own; the cycle does, so both streams pay:
    // Rp 150.000 online, under its Rp 200.000 ceiling, and Rp 100.000 offline, which is its ceiling.
    expect(await earned(t)).toBe(250_000);
  });

  it('earns no points on the Shopping Card, which the bank no longer gives it', () => {
    const entry = findEntry('permata-shopping-card')!;
    expect(entry.program.unit).toBe('cashback');
    expect(entry.transferPartners).toEqual([]);
    expect(entry.terms[0]!.rules.map((r) => r.key)).toEqual(['online', 'other']);
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
  it('gives BNI Tzu Chi the ordinary BNI rate, its donation costing the holder nothing', async () => {
    const t = await withCard('bni-tzu-chi');
    await spend(t, 1_000_000);
    expect(await earned(t)).toBe(100);
    expect(findEntry('bni-tzu-chi')!.fees[0]!.annualFeeMinor).toBe(0);
  });
});

describe('the three cards kept as cashback, because their points are not worth having', () => {
  const CASHBACK = ['danamon-visa-platinum', 'cimb-niaga-octo-card', 'bni-mypertamina'];

  it('earn in rupiah, and say in their notes which points were given up', () => {
    for (const id of CASHBACK) {
      const entry = findEntry(id)!;
      expect(entry.program.unit, id).toBe('cashback');
      expect(entry.cashValue, id).toEqual({ valueMinor: 1, perPoints: 1, currency: 'IDR' });
      expect(entry.transferPartners, id).toEqual([]);
      expect(entry.notes[0], id).toContain('given up');
    }
  });

  it('leaves the Danamon JCB Precious on points, whose uplift is worth four times its sibling', () => {
    const precious = findEntry('danamon-jcb-precious')!;
    expect(precious.program.unit).toBe('points');
    expect(precious.transferPartners.length).toBeGreaterThan(0);
  });
});

describe('Danamon Visa Platinum, now paid at the weekend', () => {
  // 19 September 2026 is a Saturday, 16 September a Wednesday.
  const SATURDAY = '2026-09-19';
  const WEDNESDAY = '2026-09-16';

  /** Five purchases of Rp 100.000 or more, which the weekend rule needs before it pays anything. */
  async function qualify(t: Awaited<ReturnType<typeof withCard>>, on: string) {
    for (let i = 0; i < 5; i += 1) await spend(t, 200_000, { on });
  }

  it('pays 10% on a Saturday purchase and nothing on a Wednesday one', async () => {
    const sat = await withCard('danamon-visa-platinum');
    await qualify(sat, WEDNESDAY);
    await spend(sat, 1_000_000, { on: SATURDAY });
    expect(await earned(sat)).toBe(100_000);

    const wed = await withCard('danamon-visa-platinum');
    await qualify(wed, WEDNESDAY);
    await spend(wed, 1_000_000, { on: WEDNESDAY });
    expect(await earned(wed)).toBe(0);
  });

  it('ignores a weekend purchase below Rp 100.000, which does not qualify', async () => {
    const t = await withCard('danamon-visa-platinum');
    await qualify(t, WEDNESDAY);
    await spend(t, 99_999, { on: SATURDAY });
    expect(await earned(t)).toBe(0);
  });

  it('needs five purchases of Rp 100.000 before the weekend rule pays at all', async () => {
    const short = await withCard('danamon-visa-platinum');
    for (let i = 0; i < 4; i += 1) await spend(short, 200_000, { on: SATURDAY });
    expect(await earned(short)).toBe(0);

    const met = await withCard('danamon-visa-platinum');
    for (let i = 0; i < 5; i += 1) await spend(met, 200_000, { on: SATURDAY });
    expect(await earned(met)).toBe(100_000);
  });

  it('counts those five anywhere in the month, not only at the weekend', async () => {
    const t = await withCard('danamon-visa-platinum');
    await spend(t, 200_000, { on: SATURDAY });
    for (let i = 0; i < 4; i += 1) await spend(t, 200_000, { on: WEDNESDAY });
    // The one Saturday purchase of Rp 200.000 earns, because the four weekday ones carried the count.
    expect(await earned(t)).toBe(20_000);
  });

  it('leaves the bills rule ungated, since only the weekend cashback asks for the five', async () => {
    const t = await withCard('danamon-visa-platinum');
    await spend(t, 400_000, { category: 'utilities.electricity', description: 'Token listrik PLN', on: WEDNESDAY });
    expect(await earned(t)).toBe(20_000);
  });

  it('stops the weekend at Rp 200.000 and the bills at Rp 100.000, separately', async () => {
    const t = await withCard('danamon-visa-platinum');
    for (let i = 0; i < 5; i += 1) await spend(t, 6_000_000, { on: SATURDAY });
    await spend(t, 30_000_000, { category: 'utilities.electricity', description: 'Token listrik PLN', on: WEDNESDAY });
    expect(await earned(t)).toBe(300_000);
  });
});

describe('CIMB Niaga OCTO, whose online half ended on 1 April 2026', () => {
  it('pays 10% on a QRIS payment', async () => {
    const t = await withCard('cimb-niaga-octo-card');
    await spend(t, 500_000, { description: 'QRIS Warung Tegal' });
    expect(await earned(t)).toBe(50_000);
  });

  it('pays nothing on an online purchase now, where it once paid 10%', () => {
    const [before, after] = findEntry('cimb-niaga-octo-card')!.terms;
    expect(before!.effectiveTo).toBe('2026-03-31');
    expect(before!.rules.map((r) => r.key)).toEqual(['qris', 'online']);
    expect(after!.effectiveFrom).toBe('2026-04-01');
    expect(after!.rules.map((r) => r.key)).toEqual(['qris']);
  });

  it('stops at Rp 100.000 a cycle', async () => {
    const t = await withCard('cimb-niaga-octo-card');
    await spend(t, 5_000_000, { description: 'QRIS Warung Tegal' });
    expect(await earned(t)).toBe(100_000);
  });
});

describe('BNI MyPertamina at the pump', () => {
  it('pays 8% when the name and the fuel code agree', async () => {
    const t = await withCard('bni-mypertamina');
    await spend(t, 1_000_000, { category: 'transportation.fuel_cost', description: 'MyPertamina top up', mcc: '5541' });
    expect(await earned(t)).toBe(80_000);
  });

  it('pays nothing at a filling station that is not Pertamina, nor below Rp 250.000', async () => {
    const other = await withCard('bni-mypertamina');
    await spend(other, 1_000_000, { category: 'transportation.fuel_cost', description: 'Shell Kemang', mcc: '5541' });
    expect(await earned(other)).toBe(0);

    const small = await withCard('bni-mypertamina');
    await spend(small, 249_999, { category: 'transportation.fuel_cost', description: 'MyPertamina top up', mcc: '5541' });
    expect(await earned(small)).toBe(0);
  });

  it('runs uncapped, which overstates a heavy month until the real ceiling is known', async () => {
    const t = await withCard('bni-mypertamina');
    await spend(t, 50_000_000, { category: 'transportation.fuel_cost', description: 'MyPertamina top up', mcc: '5541' });
    expect(await earned(t)).toBe(4_000_000);
    expect(findEntry('bni-mypertamina')!.terms[0]!.rules[0]!.capPoints ?? null).toBeNull();
  });
});
