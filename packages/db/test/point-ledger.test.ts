import { expenseLines, statementCycleFor } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import {
  createAccount,
  createProgram,
  backfillCycles,
  deriveCycleEntries,
  listAccounts,
  listPointEntries,
  PointsError,
  postTransaction,
  programBalance,
  recordCycleActual,
  recordPointSnapshot,
  recordRedemption,
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
  const dining = await buy('2026-09-05', 'Restaurants', 500_000);
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

describe('anchoring the balance downward', () => {
  it('draws the batches down, so what is left can still be spent', async () => {
    const { database, ws, program, cycle } = await cardWithSpending();
    await deriveCycleEntries(database, ws, program.id, cycle);
    expect((await programBalance(database, ws, program.id, TODAY)).total).toBe(150);

    await recordPointSnapshot(database, ws, { programId: program.id, balance: 100, observedOn: TODAY });

    expect((await programBalance(database, ws, program.id, TODAY)).total).toBe(100);
    // The batches have to agree with the total, or more could be spent than is held.
    await recordRedemption(database, ws, { programId: program.id, kind: 'redeem', points: 100, occurredOn: TODAY, note: null, valueMinor: null });
    expect((await programBalance(database, ws, program.id, TODAY)).total).toBe(0);
  });

  it('will not let more be spent than the anchored balance', async () => {
    const { database, ws, program, cycle } = await cardWithSpending();
    await deriveCycleEntries(database, ws, program.id, cycle);

    await recordPointSnapshot(database, ws, { programId: program.id, balance: 100, observedOn: TODAY });

    await expect(
      recordRedemption(database, ws, { programId: program.id, kind: 'redeem', points: 120, occurredOn: TODAY, note: null, valueMinor: null }),
    ).rejects.toThrow(PointsError);
  });

  it('anchors upward into points that can be spent', async () => {
    const { database, ws, program, cycle } = await cardWithSpending();
    await deriveCycleEntries(database, ws, program.id, cycle);

    await recordPointSnapshot(database, ws, { programId: program.id, balance: 400, observedOn: TODAY });
    await recordRedemption(database, ws, { programId: program.id, kind: 'redeem', points: 400, occurredOn: TODAY, note: null, valueMinor: null });

    expect((await programBalance(database, ws, program.id, TODAY)).total).toBe(0);
  });

  it('takes everything down to nothing when the app says the balance is empty', async () => {
    const { database, ws, program, cycle } = await cardWithSpending();
    await deriveCycleEntries(database, ws, program.id, cycle);

    await recordPointSnapshot(database, ws, { programId: program.id, balance: 0, observedOn: TODAY });

    expect((await programBalance(database, ws, program.id, TODAY)).total).toBe(0);
  });
});

describe('catching a card up', () => {
  /** A purchase five cycles back, which no page has ever derived. */
  async function withOldSpending() {
    const { database, ws, card, program } = await cardWithSpending();
    const all = await listAccounts(database, ws);
    const groceries = all.find((account) => account.name === 'Groceries')!.id;
    await postTransaction(database, ws, {
      occurredOn: '2026-04-05',
      description: 'Old shop',
      lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: card.id, amountMinor: 2_000_000, currency: 'IDR' }),
    });
    return { database, ws, card, program };
  }

  it('finds points earned before the app was ever opened on this card', async () => {
    const { database, ws, program } = await withOldSpending();
    expect((await programBalance(database, ws, program.id, TODAY)).total).toBe(0);

    await backfillCycles(database, ws, program.id, 8, TODAY);

    // The April purchase at one point per 10.000, plus the two in the current cycle.
    expect((await programBalance(database, ws, program.id, TODAY)).total).toBe(350);
  });

  it('changes nothing when it runs again', async () => {
    const { database, ws, program } = await withOldSpending();

    await backfillCycles(database, ws, program.id, 8, TODAY);
    await backfillCycles(database, ws, program.id, 8, TODAY);

    expect((await programBalance(database, ws, program.id, TODAY)).total).toBe(350);
  });

  it('reaches back only as far as it is asked to', async () => {
    const { database, ws, program } = await withOldSpending();

    await backfillCycles(database, ws, program.id, 2, TODAY);

    // Two cycles does not reach April, so only the current cycle's purchases are counted.
    expect((await programBalance(database, ws, program.id, TODAY)).total).toBe(150);
  });

  it('says how many cycles it worked out', async () => {
    const { database, ws, program } = await withOldSpending();

    expect(await backfillCycles(database, ws, program.id, 4, TODAY)).toBe(4);
  });
});
