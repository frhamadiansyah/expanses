import { expenseLines, statementCycleFor } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import {
  createAccount,
  createProgram,
  deriveCycleEntries,
  listAccounts,
  listPointEntries,
  postTransaction,
  programBalance,
  recordCycleActual,
  recordPointSnapshot,
  recordTransactionPointActual,
  saveCardTerms,
  saveEarnRule,
} from '../src/index';
import { setupDb } from './helpers';

const TODAY = '2026-09-13';

/** A card earning 1 point per Rp 10.000, with two purchases inside the September cycle. */
async function cardWithSpending() {
  const { database, ws } = await setupDb();
  const card = await createAccount(database, ws, { name: 'CIMB Octo', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  const all = await listAccounts(database, ws);
  const id = (name: string) => all.find((account) => account.name === name)!.id;

  await saveCardTerms(database, ws, { accountId: card.id, statementDay: 20, dueDay: 8, creditLimitMinor: null, annualFeeMinor: 750_000 });
  const program = await createProgram(database, ws, { cardAccountId: card.id, name: 'Octo Points', unit: 'points', cycleAnchor: 'statement' });
  await saveEarnRule(database, ws, program.id, {
    name: 'Base',
    priority: 0,
    stackable: false,
    match: {},
    rateNum: 1,
    rateDen: 10_000,
    rounding: 'per_transaction_floor',
    capSpendMinor: null,
    capPoints: null,
    minTransactionMinor: null,
    validFrom: null,
    validTo: null,
  });

  const buy = (occurredOn: string, category: string, amountMinor: number) =>
    postTransaction(database, ws, {
      occurredOn,
      description: category,
      lines: expenseLines({ categoryAccountId: id(category), paymentAccountId: card.id, amountMinor, currency: 'IDR' }),
    });

  const groceries = await buy('2026-09-01', 'Groceries', 1_000_000);
  const dining = await buy('2026-09-05', 'Dining Out', 500_000);
  const cycle = statementCycleFor(TODAY, 20);

  return { database, ws, card, program, cycle, groceries, dining };
}

describe('deriving a cycle', () => {
  it('works the points out itself when nothing has been typed in', async () => {
    const { database, ws, program, cycle } = await cardWithSpending();

    await deriveCycleEntries(database, ws, program.id, cycle);

    const entries = await listPointEntries(database, ws, program.id);
    expect(entries.every((entry) => entry.status === 'projected')).toBe(true);
    // 1.000.000 and 500.000 at one point per 10.000.
    expect(await programBalance(database, ws, program.id, TODAY)).toMatchObject({ total: 150, postedTotal: 0, projectedTotal: 150 });
  });

  it('takes the figures the app showed per purchase over its own working', async () => {
    const { database, ws, program, cycle, groceries, dining } = await cardWithSpending();
    await recordTransactionPointActual(database, ws, { programId: program.id, transactionId: groceries, actualPoints: 120 });
    await recordTransactionPointActual(database, ws, { programId: program.id, transactionId: dining, actualPoints: 50 });

    await deriveCycleEntries(database, ws, program.id, cycle);

    expect(await programBalance(database, ws, program.id, TODAY)).toMatchObject({ total: 170, postedTotal: 170, projectedTotal: 0 });
  });

  it('falls back to the statement total when the purchases were never checked', async () => {
    const { database, ws, program, cycle } = await cardWithSpending();
    await recordCycleActual(database, ws, { programId: program.id, cycleStart: cycle.start, actualPoints: 160 });

    await deriveCycleEntries(database, ws, program.id, cycle);

    const entries = await listPointEntries(database, ws, program.id);
    expect(entries.filter((entry) => entry.kind === 'earn')).toHaveLength(1);
    expect(await programBalance(database, ws, program.id, TODAY)).toMatchObject({ total: 160, postedTotal: 160 });
  });

  it('prefers what each purchase earned to the statement total', async () => {
    const { database, ws, program, cycle, groceries, dining } = await cardWithSpending();
    await recordCycleActual(database, ws, { programId: program.id, cycleStart: cycle.start, actualPoints: 160 });
    await recordTransactionPointActual(database, ws, { programId: program.id, transactionId: groceries, actualPoints: 120 });
    await recordTransactionPointActual(database, ws, { programId: program.id, transactionId: dining, actualPoints: 50 });

    await deriveCycleEntries(database, ws, program.id, cycle);

    expect((await programBalance(database, ws, program.id, TODAY)).total).toBe(170);
  });

  it('promotes what it guessed once the real figures are typed in', async () => {
    const { database, ws, program, cycle, groceries, dining } = await cardWithSpending();
    await deriveCycleEntries(database, ws, program.id, cycle);
    expect((await programBalance(database, ws, program.id, TODAY)).projectedTotal).toBe(150);

    await recordTransactionPointActual(database, ws, { programId: program.id, transactionId: groceries, actualPoints: 120 });
    await recordTransactionPointActual(database, ws, { programId: program.id, transactionId: dining, actualPoints: 50 });
    await deriveCycleEntries(database, ws, program.id, cycle);

    expect(await programBalance(database, ws, program.id, TODAY)).toMatchObject({ postedTotal: 170, projectedTotal: 0 });
  });

  it('writes the same entries when run twice, rather than doubling them', async () => {
    const { database, ws, program, cycle } = await cardWithSpending();

    await deriveCycleEntries(database, ws, program.id, cycle);
    await deriveCycleEntries(database, ws, program.id, cycle);

    expect((await programBalance(database, ws, program.id, TODAY)).total).toBe(150);
  });
});

describe('a balance read from the app', () => {
  it('anchors the balance with a single correction', async () => {
    const { database, ws, program, cycle } = await cardWithSpending();
    await deriveCycleEntries(database, ws, program.id, cycle);

    await recordPointSnapshot(database, ws, { programId: program.id, balance: 200, observedOn: TODAY });

    const adjustments = (await listPointEntries(database, ws, program.id)).filter((entry) => entry.kind === 'adjust');
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0]!.quantity).toBe(50);
    expect((await programBalance(database, ws, program.id, TODAY)).total).toBe(200);
  });

  it('is left alone when the cycle is worked out again', async () => {
    const { database, ws, program, cycle } = await cardWithSpending();
    await deriveCycleEntries(database, ws, program.id, cycle);
    await recordPointSnapshot(database, ws, { programId: program.id, balance: 200, observedOn: TODAY });

    await deriveCycleEntries(database, ws, program.id, cycle);

    expect((await listPointEntries(database, ws, program.id)).filter((entry) => entry.kind === 'adjust')).toHaveLength(1);
    expect((await programBalance(database, ws, program.id, TODAY)).total).toBe(200);
  });
});
