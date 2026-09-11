import { type CatalogEntry, findEntry } from '@expanses/catalog';
import { computeCycleEarn, expenseLines } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import {
  applyCatalogEntry,
  applyCatalogUpdate,
  CatalogError,
  cardSpendLines,
  createAccount,
  createProgram,
  dismissCatalogVersion,
  type EarnRuleInput,
  getCatalogState,
  listAccounts,
  listCardTerms,
  listCycleBonuses,
  listEarnRules,
  listPrograms,
  listRedemptionOptions,
  listTransferPartners,
  postTransaction,
  resetToCatalog,
  saveCardTerms,
  saveEarnRule,
  syncLinkedPrograms,
} from '../src/index';
import { setupDb } from './helpers';

const TODAY = '2026-09-11';
const entry = (id: string): CatalogEntry => structuredClone(findEntry(id)!);
const MANUAL: EarnRuleInput = {
  name: 'Dining promo', priority: 10, stackable: true, match: {}, rateNum: 1, rateDen: 10_000,
  rounding: 'per_transaction_floor', capSpendMinor: null, capPoints: null, minTransactionMinor: null, validFrom: null, validTo: null,
};

async function withCard(name = 'BCA KrisFlyer Signature') {
  const t = await setupDb();
  const card = await createAccount(t.database, t.ws, { name, kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  return { ...t, card };
}

const byValidFrom = <T extends { validFrom: string | null }>(rows: T[]) => [...rows].sort((a, b) => (a.validFrom ?? '').localeCompare(b.validFrom ?? ''));

/** Signature version 2: BCA raises the spend per mile to Rp 15.000 from 2026-10-01. */
function signatureV2(): CatalogEntry {
  const next = entry('bca-sq-krisflyer-visa-signature');
  next.entryVersion += 1;
  const current = next.terms[1]!;
  current.effectiveTo = '2026-09-30';
  const raised = { ...structuredClone(current), effectiveFrom: '2026-10-01', effectiveTo: null };
  raised.rules[0]!.rateDen = 15_000;
  next.terms.push(raised);
  return next;
}

describe('applyCatalogEntry', () => {
  it('applies Signature as dated rules and bonuses on a new linked program', async () => {
    const { database, ws, card } = await withCard();
    const signature = entry('bca-sq-krisflyer-visa-signature');
    const { programId, unmappedKeys } = await applyCatalogEntry(database, ws, { cardAccountId: card.id, entry: signature, today: TODAY, replaceManual: false });
    expect(unmappedKeys).toEqual([]);
    expect(await listPrograms(database, ws)).toMatchObject([
      { id: programId, cardAccountId: card.id, name: 'KrisFlyer', unit: 'miles', cycleAnchor: 'statement', catalogEntryId: signature.id, catalogEntryVersion: signature.entryVersion, catalogStatus: 'linked' },
    ]);
    const rules = byValidFrom(await listEarnRules(database, ws, programId));
    expect(rules.map((r) => [r.validFrom, r.validTo, r.rateNum, r.rateDen])).toEqual([
      ['2024-08-12', '2025-09-22', 1, 13_500],
      ['2025-09-23', null, 1, 13_500],
    ]);
    expect(rules[1]!.match.excludeCategoryIds).toHaveLength(6);
    expect(rules[1]!.match.excludeMerchantPatterns).toEqual(['prudential']);
    expect(byValidFrom(await listCycleBonuses(database, ws, programId)).map((b) => [b.validFrom, b.validTo, b.tiers])).toEqual([
      ['2024-08-12', '2025-09-22', [{ minSpendMinor: 20_000_000, bonus: 1000 }]],
      ['2025-09-23', null, [{ minSpendMinor: 20_000_000, bonus: 1000 }]],
    ]);
    expect(await getCatalogState(database, ws, programId)).toEqual({ entryId: signature.id, entryVersion: signature.entryVersion, status: 'linked', dismissedVersion: null, snapshot: signature });
  });

  it('applies UnionPay partners and cash value onto the card’s existing empty program', async () => {
    const { database, ws, card } = await withCard('BCA UnionPay');
    const existing = await createProgram(database, ws, { cardAccountId: card.id, name: 'Points', unit: 'points', cycleAnchor: 'calendar' });
    const { programId } = await applyCatalogEntry(database, ws, { cardAccountId: card.id, entry: entry('bca-unionpay'), today: TODAY, replaceManual: false });
    expect(programId).toBe(existing.id);
    expect(await listPrograms(database, ws)).toMatchObject([{ id: existing.id, name: 'UnionPay Points', cycleAnchor: 'statement' }]);
    expect((await listTransferPartners(database, ws, programId)).map((p) => p.key).sort()).toEqual(['airasia', 'garudamiles', 'jal', 'krisflyer']);
    expect(await listRedemptionOptions(database, ws, programId)).toMatchObject([{ valueMinor: 20, perPoints: 1, currency: 'IDR', catalogKey: 'cash-value' }]);
  });

  it('refuses to replace manual rules without consent, and replaces them with it', async () => {
    const { database, ws, card } = await withCard();
    const program = await createProgram(database, ws, { cardAccountId: card.id, name: 'KrisFlyer', unit: 'miles', cycleAnchor: 'statement' });
    const manualId = await saveEarnRule(database, ws, program.id, MANUAL);
    const input = { cardAccountId: card.id, entry: entry('bca-sq-krisflyer-visa-signature'), today: TODAY };
    await expect(applyCatalogEntry(database, ws, { ...input, replaceManual: false })).rejects.toThrow(CatalogError);
    expect((await listEarnRules(database, ws, program.id)).map((r) => r.id)).toEqual([manualId]);
    await applyCatalogEntry(database, ws, { ...input, replaceManual: true });
    expect((await listEarnRules(database, ws, program.id)).map((r) => r.name)).toEqual(['Base', 'Base']);
  });

  it('sets the card annual fee in force today and never the statement day', async () => {
    const { database, ws, card } = await withCard('BCA KrisFlyer Infinite');
    await saveCardTerms(database, ws, { accountId: card.id, statementDay: 25, dueDay: 12, creditLimitMinor: null, annualFeeMinor: null });
    await applyCatalogEntry(database, ws, { cardAccountId: card.id, entry: entry('bca-sq-krisflyer-visa-infinite'), today: TODAY, replaceManual: false });
    expect(await listCardTerms(database, ws)).toMatchObject([{ accountId: card.id, statementDay: 25, dueDay: 12, annualFeeMinor: 1_000_000 }]);

    const cimb = await createAccount(database, ws, { name: 'CIMB Accor', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    await applyCatalogEntry(database, ws, { cardAccountId: cimb.id, entry: entry('cimb-niaga-world-all-accor'), today: TODAY, replaceManual: false });
    expect((await listCardTerms(database, ws)).map((t) => t.accountId)).toEqual([card.id]);
  });

  it('reports exclusions whose category is archived', async () => {
    const { database, ws, card } = await withCard();
    await database.execScript(`UPDATE accounts SET archived_at = '${TODAY}T00:00:00.000Z' WHERE system_key = 'government'`);
    const { unmappedKeys } = await applyCatalogEntry(database, ws, { cardAccountId: card.id, entry: entry('bca-sq-krisflyer-visa-signature'), today: TODAY, replaceManual: false });
    expect(unmappedKeys).toEqual(['government']);
  });

  it('rejects an account that is not a credit card', async () => {
    const { database, ws } = await withCard();
    const bank = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    await expect(applyCatalogEntry(database, ws, { cardAccountId: bank.id, entry: entry('bca-unionpay'), today: TODAY, replaceManual: false })).rejects.toThrow(CatalogError);
  });
});

describe('catalogue updates', () => {
  it('syncs linked programs to a newer entry version and leaves customised ones alone', async () => {
    const { database, ws, card } = await withCard();
    const infiniteCard = await createAccount(database, ws, { name: 'BCA KrisFlyer Infinite', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    const linked = await applyCatalogEntry(database, ws, { cardAccountId: card.id, entry: entry('bca-sq-krisflyer-visa-signature'), today: TODAY, replaceManual: false });
    const customised = await applyCatalogEntry(database, ws, { cardAccountId: infiniteCard.id, entry: entry('bca-sq-krisflyer-visa-infinite'), today: TODAY, replaceManual: false });
    await saveEarnRule(database, ws, customised.programId, MANUAL);

    const catalog = [signatureV2(), { ...entry('bca-sq-krisflyer-visa-infinite'), entryVersion: entry('bca-sq-krisflyer-visa-infinite').entryVersion + 1 }];
    expect(await syncLinkedPrograms(database, ws, catalog, '2026-09-12')).toEqual([linked.programId]);
    expect(await syncLinkedPrograms(database, ws, catalog, '2026-09-12')).toEqual([]);
    expect(byValidFrom(await listEarnRules(database, ws, linked.programId)).map((r) => [r.validFrom, r.validTo, r.rateDen])).toEqual([
      ['2024-08-12', '2025-09-22', 13_500],
      ['2025-09-23', '2026-09-30', 13_500],
      ['2026-10-01', null, 15_000],
    ]);
    expect(await getCatalogState(database, ws, linked.programId)).toMatchObject({ entryVersion: signatureV2().entryVersion, status: 'linked', snapshot: signatureV2() });
    expect(await getCatalogState(database, ws, customised.programId)).toMatchObject({ entryVersion: entry('bca-sq-krisflyer-visa-infinite').entryVersion, status: 'customised' });
  });

  it('keeps past-cycle points after a sync that changes the rate from a later date', async () => {
    const { database, ws, card } = await withCard();
    const { programId } = await applyCatalogEntry(database, ws, { cardAccountId: card.id, entry: entry('bca-sq-krisflyer-visa-signature'), today: TODAY, replaceManual: false });
    const all = await listAccounts(database, ws);
    const dining = all.find((a) => a.systemKey === 'food.dining')!.id;
    const ancestors = Object.fromEntries(all.map((a) => [a.id, a.parentId ? [a.parentId] : []]));
    for (const occurredOn of ['2026-09-15', '2026-10-15']) {
      await postTransaction(database, ws, {
        occurredOn, description: 'Din Tai Fung',
        lines: expenseLines({ categoryAccountId: dining, paymentAccountId: card.id, amountMinor: 1_350_000, currency: 'IDR' }),
      });
    }
    const earned = async (from: string, to: string) => {
      const lines = await cardSpendLines(database, ws, card.id, from, to);
      const rules = await listEarnRules(database, ws, programId);
      const bonuses = await listCycleBonuses(database, ws, programId);
      return computeCycleEarn(lines, rules, ancestors, { bonuses, cycleEnd: to }).totalPoints;
    };
    expect([await earned('2026-09-01', '2026-09-30'), await earned('2026-10-01', '2026-10-31')]).toEqual([100, 100]);
    await syncLinkedPrograms(database, ws, [signatureV2()], '2026-09-12');
    expect([await earned('2026-09-01', '2026-09-30'), await earned('2026-10-01', '2026-10-31')]).toEqual([100, 90]);
  });

  it('applies an update to a customised program and keeps rules the user added', async () => {
    const { database, ws, card } = await withCard();
    const { programId } = await applyCatalogEntry(database, ws, { cardAccountId: card.id, entry: entry('bca-sq-krisflyer-visa-signature'), today: TODAY, replaceManual: false });
    await saveEarnRule(database, ws, programId, MANUAL);
    await applyCatalogUpdate(database, ws, programId, signatureV2(), '2026-09-12');
    expect((await listEarnRules(database, ws, programId)).map((r) => r.name).sort()).toEqual(['Base', 'Base', 'Base', 'Dining promo']);
    expect(await getCatalogState(database, ws, programId)).toMatchObject({ entryVersion: signatureV2().entryVersion, status: 'customised', snapshot: signatureV2() });
    await expect(applyCatalogUpdate(database, ws, programId, entry('bca-unionpay'), TODAY)).rejects.toThrow(CatalogError);
  });

  it('dismisses a version, and reset removes user rules and relinks', async () => {
    const { database, ws, card } = await withCard();
    const { programId } = await applyCatalogEntry(database, ws, { cardAccountId: card.id, entry: entry('bca-sq-krisflyer-visa-signature'), today: TODAY, replaceManual: false });
    await saveEarnRule(database, ws, programId, MANUAL);
    await dismissCatalogVersion(database, ws, programId, 2);
    expect(await getCatalogState(database, ws, programId)).toMatchObject({ status: 'customised', dismissedVersion: 2 });
    await resetToCatalog(database, ws, programId, signatureV2(), '2026-09-12');
    expect((await listEarnRules(database, ws, programId)).map((r) => r.name)).toEqual(['Base', 'Base', 'Base']);
    expect(await getCatalogState(database, ws, programId)).toMatchObject({ entryVersion: signatureV2().entryVersion, status: 'linked', dismissedVersion: null });
  });
});

describe('catalogue crediting', () => {
  it('sets crediting on apply and reset, and keeps a user-changed crediting through sync', async () => {
    const { database, ws, card } = await withCard();
    const base = entry('mandiri-world-prioritas');
    const prioritas: CatalogEntry = { ...base, program: { ...base.program, crediting: 'per_transaction' } };
    const { programId } = await applyCatalogEntry(database, ws, { cardAccountId: card.id, entry: prioritas, today: TODAY, replaceManual: false });
    const crediting = async () => (await listPrograms(database, ws)).find((p) => p.id === programId)!.crediting;
    expect(await crediting()).toBe('per_transaction');
    await database.execScript(`UPDATE reward_programs SET crediting = 'per_statement' WHERE id = '${programId}'`);
    await syncLinkedPrograms(database, ws, [{ ...prioritas, entryVersion: prioritas.entryVersion + 1 }], TODAY);
    expect(await getCatalogState(database, ws, programId)).toMatchObject({ entryVersion: prioritas.entryVersion + 1, status: 'linked' });
    expect(await crediting()).toBe('per_statement');
    await resetToCatalog(database, ws, programId, { ...prioritas, entryVersion: prioritas.entryVersion + 1 }, TODAY);
    expect(await crediting()).toBe('per_transaction');
  });
});
