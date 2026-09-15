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

const TODAY = '2026-09-14';
const FROM = '2026-09-01';
const TO = '2026-09-30';

async function withCard(creditLimitMinor: number | null = 50_000_000) {
  const t = await setupDb();
  const card = await createAccount(t.database, t.ws, { name: 'Danamon Amex Gold Charge', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  if (creditLimitMinor !== null) {
    await saveCardTerms(t.database, t.ws, { accountId: card.id, statementDay: 25, dueDay: 12, creditLimitMinor, annualFeeMinor: null });
  }
  const { programId } = await applyCatalogEntry(t.database, t.ws, {
    cardAccountId: card.id,
    entry: structuredClone(findEntry('danamon-amex-gold-charge')!),
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

describe('Danamon Amex Gold charge card earning', () => {
  it('earns 1,5 points per Rp 2.500 while spending stays under the limit', async () => {
    const t = await withCard(50_000_000);
    await spend(t, 10_000_000);
    // 4.000 whole increments: 4.000 at the base and 2.000 stacked on top.
    expect(await earned(t)).toBe(6_000);
  });

  it('drops to 1 per Rp 2.500 on the spend above the limit', async () => {
    const t = await withCard(10_000_000);
    await spend(t, 30_000_000);
    // Base on all Rp 30.000.000 is 12.000; the half only reaches the first Rp 10.000.000, worth 2.000.
    expect(await earned(t)).toBe(14_000);
  });

  it('falls back to the plain rate for a month that exactly fills the limit', async () => {
    const t = await withCard(10_000_000);
    await spend(t, 10_000_000);
    expect(await earned(t)).toBe(4_000 + 2_000);
  });

  it('runs the uplift uncapped when no limit is recorded, which overstates a big month', async () => {
    const t = await withCard(null);
    const uplift = (await listEarnRules(t.database, t.ws, t.programId)).find((r) => r.name.startsWith('Half a point'))!;
    expect(uplift.capSpendMinor).toBeNull();
    await spend(t, 100_000_000);
    expect(await earned(t)).toBe(60_000);
  });

  it('earns nothing on insurance, a cash advance or an instalment', async () => {
    const t = await withCard();
    await spend(t, 2_000_000, 'protection.health_insurance');
    await spend(t, 2_000_000, 'shopping', 'Tarik tunai ATM');
    await spend(t, 2_000_000, 'shopping', 'Belanja cicilan 12 bulan');
    expect(await earned(t)).toBe(0);
  });
});

describe('the charge card against the credit card', () => {
  it('costs Rp 1.200.000 a year where the credit card costs Rp 350.000', () => {
    expect(findEntry('danamon-amex-gold-charge')!.fees[0]!.annualFeeMinor).toBe(1_200_000);
    expect(findEntry('danamon-amex-gold-credit-card')!.fees[0]!.annualFeeMinor).toBe(350_000);
  });

  it('earns half a point more under the limit, where the credit card earns one rate throughout', () => {
    expect(findEntry('danamon-amex-gold-charge')!.terms[0]!.rules).toHaveLength(2);
    expect(findEntry('danamon-amex-gold-credit-card')!.terms[0]!.rules).toHaveLength(1);
  });

  it('shares the Membership Rewards programme, and says the ratios are carried over', () => {
    for (const id of ['danamon-amex-gold-charge', 'danamon-amex-gold-credit-card']) {
      expect(findEntry(id)!.program.name, id).toBe('Membership Rewards');
    }
    // The ratios were read off this card's own screens, and the credit card borrows them rather than the other way about.
    expect(findEntry('danamon-amex-gold-charge')!.notes.some((n) => n.includes("cardholder's own Frequent Traveller Option screens"))).toBe(true);
    expect(findEntry('danamon-amex-gold-credit-card')!.notes.some((n) => n.includes('carried over because the two share one Membership Rewards balance'))).toBe(true);
  });
});

describe('what the charge card uplift does to the cost of a mile', () => {
  it('brings a KrisFlyer mile from Rp 15.000 to Rp 10.000 while spending stays under the limit', () => {
    const krisflyer = findEntry('danamon-amex-gold-charge')!.transferPartners.find((p) => p.program === 'KrisFlyer')!;
    const perMileAtBase = krisflyer.points * 2_500;
    expect(perMileAtBase).toBe(15_000);
    // The uplift earns 1,5 points for the same rupiah, so a mile costs two thirds of that.
    expect((perMileAtBase * 2) / 3).toBe(10_000);
  });

  it('carries the same six ratios as the credit card, the balance being shared', () => {
    const ratio = (id: string) =>
      Object.fromEntries(findEntry(id)!.transferPartners.map((p) => [p.program, [p.points, p.partnerUnits]]));
    expect(ratio('danamon-amex-gold-charge')).toEqual(ratio('danamon-amex-gold-credit-card'));
  });
});

describe('the hotels, whose units do not cost a whole number of points', () => {
  const hotelsOf = (id: string) =>
    findEntry(id)!.transferPartners.filter((p) => ['Hilton Honors', 'Marriott Bonvoy'].includes(p.program));

  it('keeps the published minimum and steps in the smallest block that is whole on both sides', () => {
    const [hilton, bonvoy] = hotelsOf('danamon-amex-gold-charge');
    // 1.250 Hilton for 7.000 points, stepping 5 for 28; 990 Bonvoy for 6.250, stepping 99 for 625.
    expect([hilton!.minimumPoints, hilton!.incrementPartnerUnits, hilton!.incrementPoints]).toEqual([7_000, 5, 28]);
    expect([bonvoy!.minimumPoints, bonvoy!.incrementPartnerUnits, bonvoy!.incrementPoints]).toEqual([6_250, 99, 625]);
  });

  it('has minimums that are whole numbers of those blocks', () => {
    for (const hotel of hotelsOf('danamon-amex-gold-charge')) {
      expect(hotel.minimumPoints! % hotel.incrementPoints, hotel.program).toBe(0);
    }
  });

  it('converts a balance past the minimum without wasting most of it', async () => {
    const t = await withCard();
    const partners = await listTransferPartners(t.database, t.ws, t.programId);
    const at = (program: string, points: number) => convertPoints(points, partners.find((p) => p.program === program)!);
    expect(at('Hilton Honors', 7_000)).toBe(1_250);
    expect(at('Marriott Bonvoy', 6_250)).toBe(990);
    // Below the minimum nothing moves at all.
    expect(at('Hilton Honors', 6_999)).toBe(0);
    expect(at('Marriott Bonvoy', 6_249)).toBe(0);
    // A 25.700 balance: the fine step gets most of it out, where a whole-minimum block would have left a third behind.
    expect(at('Hilton Honors', 25_700)).toBe(4_585);
    expect(at('Marriott Bonvoy', 25_700)).toBe(4_059);
  });

  it('carries the same hotel ratios on the credit card', () => {
    const shape = (id: string) => hotelsOf(id).map((p) => [p.program, p.points, p.partnerUnits, p.incrementPoints, p.minimumPoints]);
    expect(shape('danamon-amex-gold-charge')).toEqual(shape('danamon-amex-gold-credit-card'));
  });
});
