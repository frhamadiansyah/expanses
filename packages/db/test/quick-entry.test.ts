import { expenseLines, incomeLines, refundLines, UNCATEGORISED } from '@expanses/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BudgetError,
  categoryTotalsBetween,
  createAccount,
  createBook,
  listAccounts,
  nativeBalances,
  postTransaction,
  saveBudget,
  uncategorisedCategory,
} from '../src/index';
import { setupDb, type TestDb } from './helpers';

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

async function workspace() {
  current = await setupDb();
  const { database, ws } = current;
  const bank = (await createAccount(database, ws, { name: 'Bank', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 5_000_000 })).id;
  const card = (await createAccount(database, ws, { name: 'Card', kind: 'liability', subtype: 'credit_card', currency: 'IDR' })).id;
  return { database, ws, bank, card };
}

describe('saving now and choosing the category later', () => {
  it('posts an expense with no category against Uncategorised, made once and reused', async () => {
    const { database, ws, bank } = await workspace();
    const before = (await listAccounts(database, ws)).filter((a) => a.systemKey === UNCATEGORISED.expense.key);
    expect(before).toEqual([]);

    const first = await uncategorisedCategory(database, ws, 'expense');
    await postTransaction(database, ws, { occurredOn: '2026-10-01', description: 'Something', lines: expenseLines({ categoryAccountId: first, paymentAccountId: bank, amountMinor: 25_000, currency: 'IDR' }) });
    const second = await uncategorisedCategory(database, ws, 'expense');
    await postTransaction(database, ws, { occurredOn: '2026-10-02', description: 'Something else', lines: expenseLines({ categoryAccountId: second, paymentAccountId: bank, amountMinor: 15_000, currency: 'IDR' }) });

    expect(second).toBe(first);
    const made = (await listAccounts(database, ws)).filter((a) => a.systemKey === UNCATEGORISED.expense.key);
    // One category, at the top of the spending tree, named for what it is.
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ id: first, kind: 'expense', subtype: 'category', name: 'Uncategorised', parentId: null });
    const totals = await categoryTotalsBetween(database, ws, 'expense', '2026-10-01', '2026-10-31');
    expect(totals.find((row) => row.accountId === first)).toMatchObject({ amountBaseMinor: 40_000, transactions: 2 });
  });

  it('keeps income apart: its own Uncategorised, of the income kind', async () => {
    const { database, ws, bank } = await workspace();
    const spending = await uncategorisedCategory(database, ws, 'expense');
    const earning = await uncategorisedCategory(database, ws, 'income');
    expect(earning).not.toBe(spending);
    expect(await uncategorisedCategory(database, ws, 'income')).toBe(earning);

    await postTransaction(database, ws, { occurredOn: '2026-10-03', description: 'Paid back', lines: incomeLines({ incomeAccountId: earning, depositAccountId: bank, amountMinor: 70_000, currency: 'IDR' }) });
    const income = (await listAccounts(database, ws)).find((a) => a.id === earning)!;
    expect(income).toMatchObject({ kind: 'income', systemKey: UNCATEGORISED.income.key, name: 'Uncategorised', parentId: null });
    expect((await categoryTotalsBetween(database, ws, 'income', '2026-10-01', '2026-10-31')).find((row) => row.accountId === earning)?.amountBaseMinor).toBe(70_000);
  });

  it('is made in the open workspace, never borrowed from another', async () => {
    const { database, ws } = await workspace();
    const personal = await uncategorisedCategory(database, ws, 'expense');
    const business = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR' });
    const inBusiness = await uncategorisedCategory(database, { ...ws, bookId: business }, 'expense');
    expect(inBusiness).not.toBe(personal);
    expect(await uncategorisedCategory(database, { ...ws, bookId: business }, 'expense')).toBe(inBusiness);
  });

  it('carries no budget', async () => {
    const { database, ws } = await workspace();
    const id = await uncategorisedCategory(database, ws, 'expense');
    await expect(saveBudget(database, ws, { categoryAccountId: id, amountMinor: 100_000 })).rejects.toThrow(BudgetError);
  });
});

describe('a refund typed with a minus', () => {
  it('gives the card back what was refunded and nets the category: the car rental', async () => {
    const { database, ws, card } = await workspace();
    const rental = (await createAccount(database, ws, { name: 'Car rental', kind: 'expense', subtype: 'category', currency: null })).id;
    // Rent 500.000 and a deposit of 500.000, on the card.
    await postTransaction(database, ws, { occurredOn: '2026-10-01', description: 'Car rental', lines: expenseLines({ categoryAccountId: rental, paymentAccountId: card, amountMinor: 1_000_000, currency: 'IDR' }) });
    // The deposit back, less 50.000 of toll.
    await postTransaction(database, ws, { occurredOn: '2026-10-05', description: 'Deposit back', lines: refundLines({ categoryAccountId: rental, paymentAccountId: card, amountMinor: 450_000, currency: 'IDR' }) });

    const balances = await nativeBalances(database, ws);
    // The card owes 550.000 (a liability is credit-negative), and Car rental spent 550.000.
    expect(balances[card]).toBe(-550_000);
    expect(balances[rental]).toBe(550_000);
    const totals = await categoryTotalsBetween(database, ws, 'expense', '2026-10-01', '2026-10-31');
    expect(totals.find((row) => row.accountId === rental)?.amountBaseMinor).toBe(550_000);
    // Nothing of it is income.
    expect(await categoryTotalsBetween(database, ws, 'income', '2026-10-01', '2026-10-31')).toEqual([]);
  });
});
