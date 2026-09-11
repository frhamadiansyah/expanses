import { computeCycleEarn, expenseLines, statementCycleFor, transferLines } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import {
  cardSpendLines,
  createAccount,
  createProgram,
  listAccounts,
  listCardTerms,
  listCycleActuals,
  listEarnRules,
  listPrograms,
  PointsError,
  postTransaction,
  recordCycleActual,
  saveCardTerms,
  saveEarnRule,
  voidTransaction,
} from '../src/index';
import { setupDb } from './helpers';

describe('points repository', () => {
  it('stores card terms, programs, rules, actuals and derives cycle spend from the ledger', async () => {
    const { database, ws } = await setupDb();
    const checking = await createAccount(database, ws, { name: 'Checking', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    const card = await createAccount(database, ws, { name: 'CIMB Octo', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    const all = await listAccounts(database, ws);
    const id = (name: string) => all.find((a) => a.name === name)!.id;

    await expect(saveCardTerms(database, ws, { accountId: checking.id, statementDay: 25, dueDay: 12, creditLimitMinor: null, annualFeeMinor: null })).rejects.toThrow(PointsError);
    await saveCardTerms(database, ws, { accountId: card.id, statementDay: 25, dueDay: 12, creditLimitMinor: 50_000_000, annualFeeMinor: 750_000 });
    await saveCardTerms(database, ws, { accountId: card.id, statementDay: 20, dueDay: 8, creditLimitMinor: 50_000_000, annualFeeMinor: 750_000 });
    expect((await listCardTerms(database, ws))[0]).toMatchObject({ statementDay: 20, dueDay: 8 });

    const program = await createProgram(database, ws, { cardAccountId: card.id, name: 'CIMB Points', unit: 'points', cycleAnchor: 'statement' });
    expect((await listPrograms(database, ws)).map((p) => p.id)).toEqual([program.id]);
    const dining = await saveEarnRule(database, ws, program.id, {
      name: '5x dining', priority: 10, stackable: false, match: { categoryIds: [id('Food & Drink')] }, rateNum: 5, rateDen: 2500,
      rounding: 'per_transaction_floor', capSpendMinor: 3_000_000, capPoints: null, minTransactionMinor: null, validFrom: null, validTo: null,
    });
    await saveEarnRule(database, ws, program.id, {
      name: 'Base', priority: 0, stackable: false, match: {}, rateNum: 1, rateDen: 2500,
      rounding: 'per_transaction_floor', capSpendMinor: null, capPoints: null, minTransactionMinor: null, validFrom: null, validTo: null,
    });
    const rules = await listEarnRules(database, ws, program.id);
    expect(rules.find((r) => r.id === dining)?.match).toEqual({ categoryIds: [id('Food & Drink')] });

    const buy = (occurredOn: string, category: string, amountMinor: number) =>
      postTransaction(database, ws, { occurredOn, description: category, lines: expenseLines({ categoryAccountId: id(category), paymentAccountId: card.id, amountMinor, currency: 'IDR' }) });
    await buy('2026-08-21', 'Dining Out', 2_000_000);
    await buy('2026-09-01', 'Groceries', 1_500_000);
    const voided = await buy('2026-09-02', 'Dining Out', 9_000_000);
    await voidTransaction(database, ws, voided);
    await buy('2026-09-21', 'Fuel', 999_999);
    await postTransaction(database, ws, { occurredOn: '2026-09-10', description: 'Pay card', lines: transferLines({ fromAccountId: checking.id, toAccountId: card.id, amountMinor: 2_000_000, currency: 'IDR' }) });

    const cycle = statementCycleFor('2026-09-11', 20);
    expect(cycle).toEqual({ start: '2026-08-21', end: '2026-09-20' });
    const lines = await cardSpendLines(database, ws, card.id, cycle.start, cycle.end);
    expect(lines.map((l) => l.amountMinor)).toEqual([2_000_000, 1_500_000]);

    const ancestors = Object.fromEntries(all.map((a) => [a.id, a.parentId ? [a.parentId] : []]));
    expect(computeCycleEarn(lines, rules, ancestors).totalPoints).toBe(4000 + 2000 + 200);

    await recordCycleActual(database, ws, { programId: program.id, cycleStart: cycle.start, actualPoints: 7000 });
    await recordCycleActual(database, ws, { programId: program.id, cycleStart: cycle.start, actualPoints: 7150 });
    expect((await listCycleActuals(database, ws, program.id)).map((a) => a.actualPoints)).toEqual([7150]);
  });
});
