import { findEntry } from '@expanses/catalog';
import { computeCycleEarn, expenseLines } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import {
  applyCatalogEntry,
  cardSpendLines,
  createAccount,
  listAccounts,
  listCycleBonuses,
  listEarnRules,
  postTransaction,
  saveCardTerms,
} from '../src/index';
import { setupDb } from './helpers';

const TODAY = '2026-09-14';
const FROM = '2026-09-01';
const TO = '2026-09-30';

async function withCard(level: string, creditLimitMinor: number | null = 100_000_000) {
  const t = await setupDb();
  const card = await createAccount(t.database, t.ws, { name: 'Danamon JCB', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  if (creditLimitMinor !== null) {
    await saveCardTerms(t.database, t.ws, { accountId: card.id, statementDay: 25, dueDay: 12, creditLimitMinor, annualFeeMinor: null });
  }
  const { programId } = await applyCatalogEntry(t.database, t.ws, {
    cardAccountId: card.id,
    entry: structuredClone(findEntry('danamon-jcb-precious')!),
    today: TODAY,
    replaceManual: false,
    memberLevel: level,
  });
  return { ...t, card, programId };
}

async function spend(t: Awaited<ReturnType<typeof withCard>>, amounts: number[], category = 'shopping') {
  const all = await listAccounts(t.database, t.ws);
  const categoryAccountId = all.find((a) => a.systemKey === category)!.id;
  for (const amountMinor of amounts) {
    await postTransaction(t.database, t.ws, {
      occurredOn: '2026-09-10',
      description: 'Belanja',
      lines: expenseLines({ categoryAccountId, paymentAccountId: t.card.id, amountMinor, currency: 'IDR' }),
    });
  }
}

async function earned(t: Awaited<ReturnType<typeof withCard>>) {
  const all = await listAccounts(t.database, t.ws);
  const ancestors = Object.fromEntries(all.map((a) => [a.id, a.parentId ? [a.parentId] : []]));
  const lines = await cardSpendLines(t.database, t.ws, t.card.id, FROM, TO);
  const rules = await listEarnRules(t.database, t.ws, t.programId);
  const bonuses = await listCycleBonuses(t.database, t.ws, t.programId);
  return computeCycleEarn(lines, rules, ancestors, { bonuses, cycleEnd: TO }).totalPoints;
}

describe('Danamon JCB Precious earning', () => {
  it('earns the base alone below Rp 1.500.000 a month', async () => {
    const t = await withCard('dana-kelolaan-50');
    await spend(t, [1_000_000]);
    // Rp 1.000.000 at 1 D-Point per Rp 2.500.
    expect(await earned(t)).toBe(400);
  });

  it('earns 3x across the whole month once it reaches Rp 1.500.000, with Rp 50 juta placed', async () => {
    const t = await withCard('dana-kelolaan-50');
    await spend(t, [1_500_000]);
    // 600 at the base plus 1.200 from the uplift is 3 per Rp 2.500.
    expect(await earned(t)).toBe(1_800);
  });

  it('earns 2,5x on the same spend with less than Rp 50 juta placed', async () => {
    const t = await withCard('dana-kelolaan-under-50');
    await spend(t, [1_500_000]);
    expect(await earned(t)).toBe(1_500);
  });

  it('reaches the floor on several small purchases, not one big one', async () => {
    const t = await withCard('dana-kelolaan-50');
    await spend(t, [500_000, 500_000, 500_000]);
    expect(await earned(t)).toBe(1_800);
  });

  it('pays the 8.000 bonus once at Rp 10.000.000, and not twice at Rp 20.000.000', async () => {
    const ten = await withCard('dana-kelolaan-50');
    await spend(ten, [10_000_000]);
    expect(await earned(ten)).toBe(4_000 + 8_000 + 8_000);

    const twenty = await withCard('dana-kelolaan-50');
    await spend(twenty, [20_000_000]);
    // Twice the spend earns twice the points, but the bonus is still 8.000.
    expect(await earned(twenty)).toBe(8_000 + 16_000 + 8_000);
  });

  it('caps the uplift at the card limit when that is smaller than Rp 300.000.000', async () => {
    const t = await withCard('dana-kelolaan-50', 20_000_000);
    const rule = (await listEarnRules(t.database, t.ws, t.programId)).find((row) => row.name.startsWith('3x'))!;
    expect(rule.capSpendMinor).toBe(20_000_000);
  });

  it('falls back to the published Rp 300.000.000 ceiling when the limit is bigger', async () => {
    const t = await withCard('dana-kelolaan-50', 500_000_000);
    const rule = (await listEarnRules(t.database, t.ws, t.programId)).find((row) => row.name.startsWith('3x'))!;
    expect(rule.capSpendMinor).toBe(300_000_000);
  });

  it('keeps the published ceiling when no credit limit is recorded, rather than going uncapped', async () => {
    const t = await withCard('dana-kelolaan-50', null);
    const rule = (await listEarnRules(t.database, t.ws, t.programId)).find((row) => row.name.startsWith('3x'))!;
    expect(rule.capSpendMinor).toBe(300_000_000);
  });

  it('stops upliftng beyond the cap, while the base keeps earning', async () => {
    const t = await withCard('dana-kelolaan-50', 5_000_000);
    await spend(t, [10_000_000]);
    // Base on all Rp 10.000.000 is 4.000; the uplift only reaches the first Rp 5.000.000, 2 per Rp 2.500 is 4.000.
    // The Rp 10.000.000 bonus pays 8.000 on top.
    expect(await earned(t)).toBe(4_000 + 4_000 + 8_000);
  });

  it('earns nothing on an insurance payment, which the terms exclude', async () => {
    const t = await withCard('dana-kelolaan-50');
    await spend(t, [2_000_000], 'health.insurance');
    expect(await earned(t)).toBe(0);
  });
});
