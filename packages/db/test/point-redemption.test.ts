import { expenseLines, statementCycleFor } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import {
  cardYearRoi,
  createAccount,
  createProgram,
  deriveCycleEntries,
  listAccounts,
  listPointEntries,
  PointsError,
  postTransaction,
  programBalance,
  recordRedemption,
  saveCardTerms,
  saveEarnRule,
  saveRedemptionOption,
  setProgramExpiry,
  type Database,
  type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';

const TODAY = '2026-09-13';

/** A card earning 1 point per Rp 10.000, worth Rp 25 a point, with a purchase in the current cycle. */
async function cardWithPoints(occurredOn = TODAY) {
  const { database, ws } = await setupDb();
  const card = await createAccount(database, ws, { name: 'CIMB Octo', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  const all = await listAccounts(database, ws);
  const id = (name: string) => all.find((account) => account.name === name)!.id;

  await saveCardTerms(database, ws, { accountId: card.id, statementDay: 20, dueDay: 8, creditLimitMinor: null, annualFeeMinor: 750_000 });
  const program = await createProgram(database, ws, { cardAccountId: card.id, name: 'Octo Points', unit: 'points', cycleAnchor: 'statement' });
  await saveEarnRule(database, ws, program.id, {
    name: 'Base', priority: 0, stackable: false, match: {}, rateNum: 1, rateDen: 10_000,
    rounding: 'per_transaction_floor', capSpendMinor: null, capPoints: null, minTransactionMinor: null, validFrom: null, validTo: null,
  });
  await saveRedemptionOption(database, ws, { programId: program.id, name: 'Cashback', type: 'cashback', perPoints: 1, valueMinor: 25, currency: 'IDR' });

  await postTransaction(database, ws, {
    occurredOn,
    description: 'Superindo',
    lines: expenseLines({ categoryAccountId: id('Groceries'), paymentAccountId: card.id, amountMinor: 10_000_000, currency: 'IDR' }),
  });
  const cycle = statementCycleFor(occurredOn, 20);
  await deriveCycleEntries(database, ws, program.id, cycle);
  return { database, ws, card, program, id, cycle };
}

/** A second, older batch, so consumption has somewhere to run over into. */
async function withAnOlderBatch(database: Database, ws: WorkspaceContext, cardId: string, categoryId: string, programId: string) {
  const older = '2026-07-05';
  await postTransaction(database, ws, {
    occurredOn: older,
    description: 'Older shop',
    lines: expenseLines({ categoryAccountId: categoryId, paymentAccountId: cardId, amountMinor: 3_000_000, currency: 'IDR' }),
  });
  await deriveCycleEntries(database, ws, programId, statementCycleFor(older, 20));
}

describe('spending points', () => {
  it('takes them off the balance, naming the batch they came from', async () => {
    const { database, ws, program } = await cardWithPoints();

    await recordRedemption(database, ws, { programId: program.id, kind: 'redeem', points: 400, occurredOn: TODAY, note: 'Cashback', valueMinor: 10_000 });

    const spent = (await listPointEntries(database, ws, program.id)).filter((entry) => entry.kind === 'redeem');
    expect(spent).toHaveLength(1);
    expect(spent[0]).toMatchObject({ quantity: -400, valueMinor: 10_000 });
    expect(spent[0]!.batchId).not.toBeNull();
    expect((await programBalance(database, ws, program.id, TODAY)).total).toBe(600);
  });

  it('runs into a second batch when the first cannot cover it', async () => {
    const { database, ws, card, program, id } = await cardWithPoints();
    await withAnOlderBatch(database, ws, card.id, id('Groceries'), program.id);

    // 300 older points and 1.000 newer ones; spending 500 empties the older batch first.
    await recordRedemption(database, ws, { programId: program.id, kind: 'redeem', points: 500, occurredOn: TODAY, note: null, valueMinor: null });

    const spent = (await listPointEntries(database, ws, program.id)).filter((entry) => entry.kind === 'redeem');
    expect(spent).toHaveLength(2);
    expect(spent.reduce((total, entry) => total + entry.quantity, 0)).toBe(-500);
    expect((await programBalance(database, ws, program.id, TODAY)).total).toBe(800);
  });

  it('refuses to spend more than is held', async () => {
    const { database, ws, program } = await cardWithPoints();

    await expect(
      recordRedemption(database, ws, { programId: program.id, kind: 'redeem', points: 5_000, occurredOn: TODAY, note: null, valueMinor: null }),
    ).rejects.toThrow(PointsError);
    expect((await programBalance(database, ws, program.id, TODAY)).total).toBe(1_000);
  });

  it('records moving points to an airline as a transfer, not a redemption', async () => {
    const { database, ws, program } = await cardWithPoints();

    await recordRedemption(database, ws, { programId: program.id, kind: 'transfer', points: 200, occurredOn: TODAY, note: 'KrisFlyer', valueMinor: null });

    const entries = await listPointEntries(database, ws, program.id);
    expect(entries.filter((entry) => entry.kind === 'transfer')).toHaveLength(1);
    expect(entries.filter((entry) => entry.kind === 'redeem')).toHaveLength(0);
  });

  it('will not spend points that have already died', async () => {
    const { database, ws, program, cycle } = await cardWithPoints('2024-03-05');
    await setProgramExpiry(database, ws, program.id, 'months_from_earn', 12);
    await deriveCycleEntries(database, ws, program.id, cycle);

    await expect(
      recordRedemption(database, ws, { programId: program.id, kind: 'redeem', points: 100, occurredOn: TODAY, note: null, valueMinor: null }),
    ).rejects.toThrow(PointsError);
  });
});

describe('what the annual fee bought', () => {
  it('runs the year from the day the fee was charged', async () => {
    const { database, ws, card, program, id } = await cardWithPoints();
    await postTransaction(database, ws, {
      occurredOn: '2026-03-01',
      description: 'Annual fee',
      lines: expenseLines({ categoryAccountId: id('Card Annual Fee'), paymentAccountId: card.id, amountMinor: 600_000, currency: 'IDR' }),
    });

    const roi = await cardYearRoi(database, ws, program.id, TODAY);

    expect(roi).toMatchObject({ from: '2026-03-01', to: '2027-02-28', anchoredOn: 'fee', annualFeeMinor: 600_000 });
  });

  it('values the points the year earned at the best rate, and nets the fee', async () => {
    const { database, ws, card, program, id } = await cardWithPoints();
    await postTransaction(database, ws, {
      occurredOn: '2026-03-01',
      description: 'Annual fee',
      lines: expenseLines({ categoryAccountId: id('Card Annual Fee'), paymentAccountId: card.id, amountMinor: 600_000, currency: 'IDR' }),
    });

    const roi = await cardYearRoi(database, ws, program.id, TODAY);

    // 1.000 points at Rp 25 is Rp 25.000, well short of a Rp 600.000 fee.
    expect(roi.pointsEarned).toBe(1_000);
    expect(roi.valueMinor).toBe(25_000);
    expect(roi.netMinor).toBe(-575_000);
  });

  it('falls back to the last twelve months when no fee was ever charged, and says so', async () => {
    const { database, ws, program } = await cardWithPoints();

    const roi = await cardYearRoi(database, ws, program.id, TODAY);

    expect(roi).toMatchObject({ anchoredOn: 'assumed', to: TODAY, annualFeeMinor: 750_000 });
  });

  it('says the figure is estimated while the points were only worked out', async () => {
    const { database, ws, program } = await cardWithPoints();

    expect((await cardYearRoi(database, ws, program.id, TODAY)).estimated).toBe(true);
  });
});
