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


describe('Danamon JCB Precious: a marketplace code earns although the category is Utilities', () => {
  it('pays on 5262 and 5964 under Utilities, and not on an ordinary utility bill', async () => {
    const out: Record<string, number> = {};
    for (const [label, category, mcc] of [
      ['marketplace', 'utilities.internet_provider', '5262'],
      ['catalogue-merchant', 'utilities', '5964'],
      ['utility-code', 'utilities.internet_provider', '4814'],
      ['no-code', 'utilities.internet_provider', undefined],
    ] as const) {
      const t = await withCard('danamon-jcb-precious', 'dana-kelolaan-under-50');
      await spend(t, 1_000_000, { category, mcc, description: 'Online store', on: '2026-09-10' });
      out[label] = await earned(t);
    }
    expect(out.marketplace).toBeGreaterThan(0);
    expect(out['catalogue-merchant']).toBeGreaterThan(0);
    expect(out['utility-code']).toBe(0);
    expect(out['no-code']).toBe(0);
  });
});
