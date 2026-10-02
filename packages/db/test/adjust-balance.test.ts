import { afterEach, describe, expect, it } from 'vitest';
import {
  adjustBalance,
  categoryTotalsBetween,
  createAccount,
  createCardAccount,
  listAccounts,
  listTransactions,
  moveMoneyIn,
  nativeBalances,
  postTransaction,
} from '../src/index';
import { setupDb, type TestDb } from './helpers';

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

async function withCash(opening = 932_500, subtype: 'cash' | 'bank' | 'ewallet' = 'cash') {
  current = await setupDb();
  const { database, ws } = current;
  const account = await createAccount(database, ws, { name: 'Wallet cash', kind: 'asset', subtype, currency: 'IDR', openingBalanceMinor: opening, openedOn: '2026-09-01' });
  return { database, ws, account };
}

const spent = async (t: TestDb, from = '2026-09-01', to = '2026-09-30') =>
  (await categoryTotalsBetween(t.database, t.ws, 'expense', from, to)).reduce((sum, row) => sum + row.amountBaseMinor, 0);
const earned = async (t: TestDb) => (await categoryTotalsBetween(t.database, t.ws, 'income', '2026-09-01', '2026-09-30')).reduce((sum, row) => sum + row.amountBaseMinor, 0);

describe('adjustBalance', () => {
  it('counts less cash as unrecorded spending, and leaves the balance at the count', async () => {
    const { database, ws, account } = await withCash();
    const result = await adjustBalance(database, ws, { accountId: account.id, actualMinor: 887_500, onDate: '2026-09-30', as: 'cashflow' });
    expect(result.differenceMinor).toBe(-45_000);
    expect((await nativeBalances(database, ws))[account.id]).toBe(887_500);
    expect(await spent(current!)).toBe(45_000);
    const category = (await listAccounts(database, ws)).find((a) => a.systemKey === 'unrecorded_spending');
    expect(category?.name).toBe('Unrecorded spending');
    const [row] = await listTransactions(database, ws, { accountId: account.id, limit: 1 });
    expect(row?.description).toBe('Counted cash');
  });

  it('counts more as unrecorded income, and makes that category only once', async () => {
    const { database, ws, account } = await withCash(100_000, 'bank');
    await adjustBalance(database, ws, { accountId: account.id, actualMinor: 130_000, onDate: '2026-09-20', as: 'cashflow' });
    await adjustBalance(database, ws, { accountId: account.id, actualMinor: 150_000, onDate: '2026-09-30', as: 'cashflow' });
    expect((await nativeBalances(database, ws))[account.id]).toBe(150_000);
    expect(await earned(current!)).toBe(50_000);
    expect((await listAccounts(database, ws)).filter((a) => a.systemKey === 'unrecorded_income')).toHaveLength(1);
    const [row] = await listTransactions(database, ws, { accountId: account.id, limit: 1 });
    expect(row?.description).toBe('Balance adjusted');
  });

  it('fixes the balance as a correction without counting as spending or income', async () => {
    const { database, ws, account } = await withCash(500_000, 'bank');
    await adjustBalance(database, ws, { accountId: account.id, actualMinor: 480_000, onDate: '2026-09-30', as: 'correction' });
    await adjustBalance(database, ws, { accountId: account.id, actualMinor: 490_000, onDate: '2026-09-30', as: 'correction' });
    expect((await nativeBalances(database, ws))[account.id]).toBe(490_000);
    expect(await spent(current!)).toBe(0);
    expect(await earned(current!)).toBe(0);
    const equity = (await listAccounts(database, ws, { includeArchived: true })).filter((a) => a.systemKey === 'balance_correction');
    expect(equity).toHaveLength(1);
    expect(equity[0]?.kind).toBe('equity');
    const [row] = await listTransactions(database, ws, { accountId: account.id, limit: 1 });
    expect(row?.entries.some((e) => e.accountSystemKey === 'balance_correction')).toBe(true);
  });

  it('refuses a count that agrees with the balance, posting nothing', async () => {
    const { database, ws, account } = await withCash();
    await expect(adjustBalance(database, ws, { accountId: account.id, actualMinor: 932_500, onDate: '2026-09-30', as: 'cashflow' })).rejects.toThrow(/nothing to adjust/);
    expect(await listTransactions(database, ws, { accountId: account.id })).toHaveLength(1);
  });

  it('takes the difference from the balance on the day counted, so later entries still move it on', async () => {
    const { database, ws, account } = await withCash(1_000_000);
    const groceries = (await listAccounts(database, ws)).find((a) => a.systemKey === 'household.groceries')!;
    await postTransaction(database, ws, {
      occurredOn: '2026-09-25',
      description: 'Pasar',
      lines: [
        { accountId: groceries.id, amountMinor: 200_000, currency: 'IDR' },
        { accountId: account.id, amountMinor: -200_000, currency: 'IDR' },
      ],
    });
    // Counted on the 10th: 950.000 then, not today's 800.000.
    const result = await adjustBalance(database, ws, { accountId: account.id, actualMinor: 950_000, onDate: '2026-09-10', as: 'cashflow' });
    expect(result.differenceMinor).toBe(-50_000);
    expect((await nativeBalances(database, ws, '2026-09-10'))[account.id]).toBe(950_000);
    expect((await nativeBalances(database, ws))[account.id]).toBe(750_000);
  });

  it('refuses what is not money', async () => {
    current = await setupDb();
    const { database, ws } = current;
    const card = await createCardAccount(database, ws, { name: 'BCA Card', subtype: 'credit_card', currency: 'IDR' });
    await expect(adjustBalance(database, ws, { accountId: card.id, actualMinor: 1, onDate: '2026-09-30', as: 'correction' })).rejects.toThrow(/not money/);
  });
});

describe('moveMoneyIn', () => {
  it('tops a wallet up from a card: the wallet takes the amount, the card owes it and the fee, the fee is spending', async () => {
    current = await setupDb();
    const { database, ws } = current;
    const wallet = await createAccount(database, ws, { name: 'GoPay', kind: 'asset', subtype: 'ewallet', currency: 'IDR' });
    const card = await createCardAccount(database, ws, { name: 'BCA Card', subtype: 'credit_card', currency: 'IDR', last4: '1234' });
    const result = await moveMoneyIn(database, ws, {
      toId: wallet.id,
      fromId: card.id,
      amountMinor: 500_000,
      feeMinor: 1_500,
      occurredOn: '2026-09-30',
      description: 'Top up',
      feeDescription: 'Top-up fee',
    });
    expect(result.feeId).not.toBeNull();
    const balances = await nativeBalances(database, ws);
    expect(balances[wallet.id]).toBe(500_000);
    // A liability's raw balance is credit-negative: owing 501.500.
    expect(balances[card.id]).toBe(-501_500);
    const fees = (await listAccounts(database, ws)).find((a) => a.systemKey === 'miscellaneous.fees_charges')!;
    const totals = await categoryTotalsBetween(database, ws, 'expense', '2026-09-01', '2026-09-30');
    expect(totals).toEqual([{ accountId: fees.id, amountBaseMinor: 1_500, transactions: 1 }]);
    expect((await listTransactions(database, ws, { accountId: card.id })).map((t) => t.description).sort()).toEqual(['Top up', 'Top-up fee']);
  });

  it('withdraws cash from a bank with an ATM fee', async () => {
    const { database, ws, account: cash } = await withCash(0);
    const bank = await createAccount(database, ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 2_000_000, openedOn: '2026-09-01' });
    await moveMoneyIn(database, ws, { toId: cash.id, fromId: bank.id, amountMinor: 500_000, feeMinor: 7_500, occurredOn: '2026-09-30', description: 'Cash withdrawal', feeDescription: 'ATM fee' });
    const balances = await nativeBalances(database, ws);
    expect(balances[cash.id]).toBe(500_000);
    expect(balances[bank.id]).toBe(1_492_500);
    expect(await spent(current!)).toBe(7_500);
  });

  it('refuses a card into cash, another currency, and a fund account as the source', async () => {
    const { database, ws, account: cash } = await withCash(0);
    const card = await createCardAccount(database, ws, { name: 'BCA Card', subtype: 'credit_card', currency: 'IDR' });
    const usd = await createAccount(database, ws, { name: 'USD', kind: 'asset', subtype: 'bank', currency: 'USD' });
    const rdn = await createAccount(database, ws, { name: 'RDN', kind: 'asset', subtype: 'fund', currency: 'IDR' });
    const base = { toId: cash.id, amountMinor: 1_000, feeMinor: 0, occurredOn: '2026-09-30', description: 'Cash withdrawal', feeDescription: 'ATM fee' };
    await expect(moveMoneyIn(database, ws, { ...base, fromId: card.id })).rejects.toThrow(/cannot come into/);
    await expect(moveMoneyIn(database, ws, { ...base, fromId: usd.id })).rejects.toThrow(/different currencies/);
    await expect(moveMoneyIn(database, ws, { ...base, fromId: rdn.id })).rejects.toThrow(/cannot come into/);
  });
});
