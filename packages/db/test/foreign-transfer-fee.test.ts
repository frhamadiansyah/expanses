import { exchangeWithFeeLines } from '@expanses/core';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AccountRow,
  categoryIdsByKey,
  createAccount,
  type Database,
  listTransactions,
  moveMoneyIn,
  nativeBalances,
  postTransaction,
  recordTaggedTransfer,
  replaceTransaction,
  voidTransaction,
  type WorkspaceContext,
} from '../src/index';
import { systemAccountId } from '../src/repos/accounts';
import { setupDb } from './helpers';

/*
 * A transfer between two currencies with a fee beside it (invented figures): Rp 1.600.000 leaves a rupiah account for
 * US$ 100 in a dollar cash account, and the bank charges Rp 25.000. The bank pays the amount and the fee together, the
 * cash account receives the converted amount alone, the fee is spending in rupiah under Fees & charges.
 */
const ON = '2026-10-04';
const RATES = { USD: 16_000 };

let database: Database;
let ws: WorkspaceContext;
let bank: AccountRow;
let cash: AccountRow;
let fees: string;
let exchange: string;

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  bank = await createAccount(database, ws, { name: 'Account A', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 20_000_000, openedOn: '2026-01-01' });
  cash = await createAccount(database, ws, { name: 'Dollar cash', kind: 'asset', subtype: 'cash', currency: 'USD' });
  fees = (await categoryIdsByKey(database, ws))['miscellaneous.fees_charges']!;
  exchange = await database.transaction((tx) => systemAccountId(tx, ws, 'currency_exchange'));
});

const lines = (feeMinor: number) =>
  exchangeWithFeeLines({
    fromAccountId: bank.id,
    fromAmountMinor: 1_600_000,
    fromCurrency: 'IDR',
    toAccountId: cash.id,
    toAmountMinor: 10_000,
    toCurrency: 'USD',
    exchangeAccountId: exchange,
    feeMinor,
    feeCategoryId: fees,
  });
const post = (feeMinor: number) => postTransaction(database, ws, { occurredOn: ON, description: 'Withdraw dollars', lines: lines(feeMinor), ratesToBase: RATES, fileTransfer: true });
const balances = async () => {
  const all = await nativeBalances(database, ws);
  return { bank: all[bank.id] ?? 0, cash: all[cash.id] ?? 0, fees: all[fees] ?? 0 };
};

describe('a transfer between two currencies with a fee', () => {
  it('takes the amount and the fee from the bank, lands the converted amount alone, and files the fee in rupiah', async () => {
    await post(25_000);
    await expect(balances()).resolves.toEqual({ bank: 20_000_000 - 1_625_000, cash: 10_000, fees: 25_000 });
    // One transaction, balanced in each currency.
    const [tx] = await listTransactions(database, ws);
    const sums = new Map<string, number>();
    for (const e of tx!.entries) sums.set(e.currency, (sums.get(e.currency) ?? 0) + e.amountMinor);
    expect([...sums.values()]).toEqual([0, 0]);
    expect(tx!.entries.find((e) => e.accountId === fees)).toMatchObject({ amountMinor: 25_000, currency: 'IDR' });
  });

  it('is the plain exchange when the fee is 0', async () => {
    await post(0);
    await expect(balances()).resolves.toEqual({ bank: 20_000_000 - 1_600_000, cash: 10_000, fees: 0 });
  });

  it('voiding takes all of it away', async () => {
    await voidTransaction(database, ws, await post(25_000));
    await expect(balances()).resolves.toEqual({ bank: 20_000_000, cash: 0, fees: 0 });
  });

  it('an edit changes the fee and round-trips: the new fee replaces the old', async () => {
    const first = await post(25_000);
    await replaceTransaction(database, ws, first, { occurredOn: ON, description: 'Withdraw dollars', lines: lines(30_000), ratesToBase: RATES, fileTransfer: true });
    await expect(balances()).resolves.toEqual({ bank: 20_000_000 - 1_630_000, cash: 10_000, fees: 30_000 });
    const live = (await listTransactions(database, ws)).filter((t) => t.status === 'posted');
    // The replaced original is a reversal beside the new one: the fee lines net to the new fee, in rupiah alone.
    const feeLines = live.flatMap((t) => t.entries).filter((e) => e.accountId === fees);
    expect(feeLines.every((e) => e.currency === 'IDR')).toBe(true);
    expect(feeLines.reduce((sum, e) => sum + e.amountMinor, 0)).toBe(30_000);
  });

  it('a transfer for a goal carries the fee too, the goal gets the landed amount only', async () => {
    const result = await recordTaggedTransfer(database, ws, {
      occurredOn: ON,
      description: 'To dollars',
      amountMinor: 1_600_000,
      toAmountMinor: 10_000,
      fromAccountId: bank.id,
      toAccountId: cash.id,
      goalId: null,
      feeMinor: 25_000,
      feeCategoryId: fees,
      ratesToBase: RATES,
    });
    expect(result.transactionId).toBeTruthy();
    await expect(balances()).resolves.toEqual({ bank: 20_000_000 - 1_625_000, cash: 10_000, fees: 25_000 });
  });

  it('refuses a fee with no category', () => {
    expect(() => exchangeWithFeeLines({ ...{ fromAccountId: 'a', fromAmountMinor: 1, fromCurrency: 'IDR', toAccountId: 'b', toAmountMinor: 1, toCurrency: 'USD', exchangeAccountId: 'x' }, feeMinor: 5 })).toThrow('Choose a category for the fee');
  });
});

describe('a cash withdrawal into another currency', () => {
  it('moveMoneyIn takes what left and the fee from the bank and lands the amount alone in the cash', async () => {
    const { transferId, feeId } = await moveMoneyIn(database, ws, {
      toId: cash.id,
      fromId: bank.id,
      amountMinor: 10_000,
      fromAmountMinor: 1_600_000,
      feeMinor: 25_000,
      occurredOn: ON,
      description: 'Cash withdrawal',
      feeDescription: 'ATM fee',
      rateToBase: 16_000,
    });
    expect(feeId).toBeNull();
    await expect(balances()).resolves.toEqual({ bank: 20_000_000 - 1_625_000, cash: 10_000, fees: 25_000 });
    await voidTransaction(database, ws, transferId);
    await expect(balances()).resolves.toEqual({ bank: 20_000_000, cash: 0, fees: 0 });
  });

  it('asks what left when the currencies differ, and a same-currency withdrawal is unchanged', async () => {
    await expect(moveMoneyIn(database, ws, { toId: cash.id, fromId: bank.id, amountMinor: 10_000, feeMinor: 0, occurredOn: ON, description: 'Cash withdrawal', feeDescription: 'ATM fee' })).rejects.toThrow('Enter what left');
    const idrCash = await createAccount(database, ws, { name: 'Rupiah cash', kind: 'asset', subtype: 'cash', currency: 'IDR' });
    const { feeId } = await moveMoneyIn(database, ws, { toId: idrCash.id, fromId: bank.id, amountMinor: 500_000, feeMinor: 6_500, occurredOn: ON, description: 'Cash withdrawal', feeDescription: 'ATM fee' });
    expect(feeId).toBeTruthy();
    const all = await nativeBalances(database, ws);
    expect(all[bank.id]).toBe(20_000_000 - 506_500);
    expect(all[idrCash.id]).toBe(500_000);
  });
});
