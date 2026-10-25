import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AccountRow,
  createAccount,
  type Database,
  goalContributionsFor,
  goalLinksFor,
  listEarmarks,
  listTransactions,
  nativeBalances,
  recordTaggedTransfer,
  replaceTransaction,
  saveAssetProfile,
  saveEarmark,
  saveGoal,
  voidTransaction,
  type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';

/*
 * A transfer for a goal with a fee beside it (invented accounts and figures): From A to B, Rp 1.000.000 for goal G, a
 * fee of Rp 2.500. A pays both, B takes the transfer alone, the fee is spending under its category, and G gains the
 * transfer only — never the fee.
 */
const TODAY = '2026-10-20';
const ON = '2026-10-04';

let database: Database;
let ws: WorkspaceContext;
let a: AccountRow;
let b: AccountRow;
let fees: AccountRow;
let goalId: string;

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  a = await createAccount(database, ws, { name: 'Account A', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 20_000_000, openedOn: '2026-01-01' });
  b = await createAccount(database, ws, { name: 'Account B', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  await saveAssetProfile(database, ws, { accountId: b.id, assetKind: 'cash', planGroup: 'invest' });
  // A category of the owner's own, with no built-in key: the strict case for every reader that skips built-ins.
  fees = await createAccount(database, ws, { name: 'Bank charges', kind: 'expense', subtype: 'category', currency: null });
  goalId = await saveGoal(database, ws, {
    name: 'Goal G',
    kind: 'other',
    growthBps: 0,
    returnBps: 0,
    stages: [{ name: 'Stage one', targetMinor: 90_000_000, targetMonths: null, dueOn: '2030-12-31' }],
  });
});

const park = (feeMinor: number) =>
  recordTaggedTransfer(database, ws, {
    occurredOn: ON,
    description: 'A to B',
    amountMinor: 1_000_000,
    fromAccountId: a.id,
    toAccountId: b.id,
    goalId,
    feeMinor,
    feeCategoryId: fees.id,
  });

const setAsideFor = async (accountId: string) =>
  (await listEarmarks(database, ws)).find((row) => row.goalId === goalId && row.accountId === accountId)?.amountMinor ?? 0;
const goalValue = async () => (await goalLinksFor(database, ws, TODAY)).filter((link) => link.goalId === goalId).reduce((total, link) => total + link.valueMinor, 0);
const month = async () => (await goalContributionsFor(database, ws, '2026-10'))[goalId] ?? 0;
const balances = async () => {
  const all = await nativeBalances(database, ws);
  return { a: all[a.id] ?? 0, b: all[b.id] ?? 0, fees: all[fees.id] ?? 0 };
};
const transferLines = (feeMinor: number) =>
  feeMinor > 0
    ? [
        { accountId: b.id, amountMinor: 1_000_000, currency: 'IDR' },
        { accountId: a.id, amountMinor: -(1_000_000 + feeMinor), currency: 'IDR' },
        { accountId: fees.id, amountMinor: feeMinor, currency: 'IDR' },
      ]
    : [
        { accountId: b.id, amountMinor: 1_000_000, currency: 'IDR' },
        { accountId: a.id, amountMinor: -1_000_000, currency: 'IDR' },
      ];
// What the web's edit form sends for a transfer for a goal: plain lines through `replaceTransaction`, the tag kept.
const edit = (id: string, feeMinor: number) => replaceTransaction(database, ws, id, { occurredOn: ON, description: 'A to B', lines: transferLines(feeMinor) });

describe('a transfer for a goal with a fee', () => {
  it('takes the transfer and the fee from A, lands the transfer in B, files the fee, and gives the goal the transfer alone', async () => {
    const result = await park(2_500);

    expect(result.setAsideMinor).toBe(1_000_000);
    await expect(balances()).resolves.toEqual({ a: 18_997_500, b: 1_000_000, fees: 2_500 });
    await expect(setAsideFor(b.id)).resolves.toBe(1_000_000);
    await expect(goalValue()).resolves.toBe(1_000_000);
    await expect(month()).resolves.toBe(1_000_000);
    // One transaction, tagged: all-or-nothing.
    const [row] = await listTransactions(database, ws);
    expect(row!.id).toBe(result.transactionId);
    expect(row!.goalId).toBe(goalId);
  });

  it('moves only the transfer off the goal\'s own promise on A, never the fee', async () => {
    await saveEarmark(database, ws, { goalId, accountId: a.id, amountMinor: 1_500_000 });
    const before = await month();

    await park(2_500);

    await expect(setAsideFor(a.id)).resolves.toBe(500_000);
    await expect(setAsideFor(b.id)).resolves.toBe(1_000_000);
    // Money the goal already had, moved: the month is unchanged, the fee included in nothing.
    await expect(month()).resolves.toBe(before);
  });

  it('an edit that takes the fee to 0 removes the fee and leaves the goal as it was', async () => {
    const result = await park(2_500);

    const replacement = await edit(result.transactionId, 0);

    await expect(balances()).resolves.toEqual({ a: 19_000_000, b: 1_000_000, fees: 0 });
    await expect(setAsideFor(b.id)).resolves.toBe(1_000_000);
    await expect(goalValue()).resolves.toBe(1_000_000);
    const [row] = await listTransactions(database, ws);
    expect(row!.id).toBe(replacement);
    expect(row!.goalId).toBe(goalId);
  });

  it('an edit that changes the fee keeps the tag, the goal and the promise moved off A as they were', async () => {
    await saveEarmark(database, ws, { goalId, accountId: a.id, amountMinor: 1_500_000 });
    const result = await park(2_500);

    const replacement = await edit(result.transactionId, 6_500);

    await expect(balances()).resolves.toEqual({ a: 18_993_500, b: 1_000_000, fees: 6_500 });
    await expect(setAsideFor(a.id)).resolves.toBe(500_000);
    await expect(setAsideFor(b.id)).resolves.toBe(1_000_000);
    // What is still promised on A and what was parked in B: the fee in neither.
    await expect(goalValue()).resolves.toBe(1_500_000);
    expect((await listTransactions(database, ws)).find((row) => row.id === replacement)?.goalId).toBe(goalId);
  });

  it('an edit that adds a fee to a transfer for a goal keeps it tagged and the goal at the transfer alone', async () => {
    const result = await park(0);
    await expect(balances()).resolves.toEqual({ a: 19_000_000, b: 1_000_000, fees: 0 });

    const replacement = await edit(result.transactionId, 2_500);

    await expect(balances()).resolves.toEqual({ a: 18_997_500, b: 1_000_000, fees: 2_500 });
    await expect(setAsideFor(b.id)).resolves.toBe(1_000_000);
    await expect(month()).resolves.toBe(1_000_000);
    expect((await listTransactions(database, ws)).find((row) => row.id === replacement)?.goalId).toBe(goalId);
  });

  it('a delete removes the transfer, the fee and what the goal was given', async () => {
    await saveEarmark(database, ws, { goalId, accountId: a.id, amountMinor: 1_500_000 });
    const result = await park(2_500);

    await voidTransaction(database, ws, result.transactionId);

    await expect(balances()).resolves.toEqual({ a: 20_000_000, b: 0, fees: 0 });
    await expect(setAsideFor(a.id)).resolves.toBe(1_500_000);
    await expect(setAsideFor(b.id)).resolves.toBe(0);
    // Back to the promise on A alone, as before the transfer.
    await expect(goalValue()).resolves.toBe(1_500_000);
  });

  it('refuses a fee with no category, a fee between two currencies, and writes nothing', async () => {
    const usd = await createAccount(database, ws, { name: 'Account C', kind: 'asset', subtype: 'bank', currency: 'USD' });
    const before = (await listTransactions(database, ws)).length;
    await expect(
      recordTaggedTransfer(database, ws, { occurredOn: ON, description: 'A to B', amountMinor: 1_000_000, fromAccountId: a.id, toAccountId: b.id, goalId, feeMinor: 2_500 }),
    ).rejects.toThrow('Choose a category for the fee');
    await expect(
      recordTaggedTransfer(database, ws, {
        occurredOn: ON,
        description: 'A to C',
        amountMinor: 1_600_000,
        toAmountMinor: 10_000,
        fromAccountId: a.id,
        toAccountId: usd.id,
        goalId,
        feeMinor: 2_500,
        feeCategoryId: fees.id,
      }),
    ).rejects.toThrow('A fee goes on a transfer within one currency');
    expect((await listTransactions(database, ws)).length).toBe(before);
    await expect(balances()).resolves.toEqual({ a: 20_000_000, b: 0, fees: 0 });
  });
});
