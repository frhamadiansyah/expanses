import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AccountRow,
  cardSpendLines,
  categoryIdsByKey,
  categoryTotalsBetween,
  checkLedgerIntegrity,
  convertToPurchase,
  createAccount,
  type Database,
  listTrades,
  listTransactions,
  nativeBalances,
  postTransaction,
  recordTrade,
  saveAssetProfile,
  saveGoal,
  type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';

const MONTH = { from: '2026-09-01', to: '2026-09-30' };

let database: Database;
let ws: WorkspaceContext;
let bca: AccountRow;
let card: AccountRow;
let gold: AccountRow;
let categories: Record<string, string>;

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  bca = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 50_000_000, openedOn: '2026-01-01' });
  card = await createAccount(database, ws, { name: 'BCA KrisFlyer', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  gold = await createAccount(database, ws, { name: 'UBS gold bars', kind: 'asset', subtype: 'investment', currency: 'IDR' });
  await saveAssetProfile(database, ws, { accountId: gold.id, assetKind: 'gold' });
  categories = await categoryIdsByKey(database, ws);
});

/** How a gold purchase arrives from a statement or a hurried evening: as plain spending. */
const recordAsExpense = (moneyAccountId: string, mcc: string | null = null) =>
  postTransaction(database, ws, {
    occurredOn: '2026-09-12',
    description: 'UBS GOLD SURABAYA',
    mcc,
    lines: [
      { accountId: categories['shopping']!, amountMinor: 3_980_000, currency: 'IDR' },
      { accountId: moneyAccountId, amountMinor: -3_980_000, currency: 'IDR' },
    ],
  });

describe('convertToPurchase', () => {
  it('turns the expense into a purchase, keeping its date and amount', async () => {
    const transactionId = await recordAsExpense(bca.id);

    const result = await convertToPurchase(database, ws, { transactionId, accountId: gold.id, unitsMicro: 2_000_000 });

    const trades = await listTrades(database, ws, { accountId: gold.id });
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({ id: result.tradeId, occurredOn: '2026-09-12', unitsMicro: 2_000_000, grossMinor: 3_980_000, cashAccountId: bca.id });
  });

  it('voids the original rather than deleting it', async () => {
    const transactionId = await recordAsExpense(bca.id);

    await convertToPurchase(database, ws, { transactionId, accountId: gold.id, unitsMicro: 2_000_000 });

    const all = await listTransactions(database, ws, { includeVoid: true });
    expect(all.find((transaction) => transaction.id === transactionId)!.status).toBe('void');
  });

  it('takes the money out of spending and puts the gold in your assets', async () => {
    const transactionId = await recordAsExpense(bca.id);
    await expect(categoryTotalsBetween(database, ws, 'expense', MONTH.from, MONTH.to)).resolves.toHaveLength(1);

    await convertToPurchase(database, ws, { transactionId, accountId: gold.id, unitsMicro: 2_000_000 });

    await expect(categoryTotalsBetween(database, ws, 'expense', MONTH.from, MONTH.to)).resolves.toEqual([]);
    const balances = await nativeBalances(database, ws);
    expect(balances[gold.id]).toBe(3_980_000);
    expect(balances[bca.id]).toBe(50_000_000 - 3_980_000);
    await expect(checkLedgerIntegrity(database, ws)).resolves.toEqual([]);
  });

  it('keeps the category and the MCC of a card purchase, so the points still count', async () => {
    const transactionId = await recordAsExpense(card.id, '5944');

    await convertToPurchase(database, ws, { transactionId, accountId: gold.id, unitsMicro: 2_000_000 });

    const lines = await cardSpendLines(database, ws, card.id, MONTH.from, MONTH.to);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ amountMinor: 3_980_000, categoryId: categories['shopping'], mcc: '5944' });
  });

  it('puts the goal on the new purchase', async () => {
    const goalId = await saveGoal(database, ws, {
      name: 'Hajj for two',
      kind: 'hajj',
      growthBps: 500,
      returnBps: 600,
      stages: [{ name: 'Setoran awal', targetMinor: 50_000_000, targetMonths: null, dueOn: '2027-06-30' }],
    });
    const transactionId = await recordAsExpense(bca.id);

    await convertToPurchase(database, ws, { transactionId, accountId: gold.id, unitsMicro: 2_000_000, goalId });

    const trades = await listTrades(database, ws, { accountId: gold.id });
    expect(trades[0]!.goalId).toBe(goalId);
  });

  it('refuses a transaction that is already a purchase', async () => {
    const trade = await recordTrade(database, ws, {
      accountId: gold.id,
      kind: 'buy',
      occurredOn: '2026-09-12',
      unitsMicro: 2_000_000,
      grossMinor: 3_980_000,
      feeMinor: 0,
      taxMinor: 0,
      cashAccountId: bca.id,
    });

    await expect(convertToPurchase(database, ws, { transactionId: trade.transactionId!, accountId: gold.id, unitsMicro: 1_000_000 })).rejects.toThrow(/already/i);
  });

  it('refuses a transaction that was voided', async () => {
    const transactionId = await recordAsExpense(bca.id);
    await convertToPurchase(database, ws, { transactionId, accountId: gold.id, unitsMicro: 2_000_000 });

    await expect(convertToPurchase(database, ws, { transactionId, accountId: gold.id, unitsMicro: 2_000_000 })).rejects.toThrow(/void/i);
  });

  it('needs units greater than zero', async () => {
    const transactionId = await recordAsExpense(bca.id);

    await expect(convertToPurchase(database, ws, { transactionId, accountId: gold.id, unitsMicro: 0 })).rejects.toThrow(/units/i);
  });

  it('keeps another workspace out', async () => {
    const transactionId = await recordAsExpense(bca.id);
    const other = await createWorkspaceForTest();

    await expect(convertToPurchase(database, other, { transactionId, accountId: gold.id, unitsMicro: 2_000_000 })).rejects.toThrow();
  });
});

async function createWorkspaceForTest(): Promise<WorkspaceContext> {
  const { createWorkspace } = await import('../src/index');
  return createWorkspace(database, { name: 'Shared', type: 'shared', baseCurrency: 'IDR' });
}
