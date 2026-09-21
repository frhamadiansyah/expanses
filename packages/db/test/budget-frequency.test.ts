import { afterEach, describe, expect, it } from 'vitest';
import { isoDate } from '@expanses/core';
import { categoryIdsByKey, createAccount, createBook, createDatabase, createWorkspace, inBook, listAccounts, listBudgets, migrate, MIGRATIONS, removeBudget, saveBudget, setBookBaseCurrency, setBudgetOverride, upsertRate } from '../src/index';
import { createNodeExecutor, type NodeExecutor } from '../src/node';
import { setupDb } from './helpers';

const MONTH = '2026-09';
let executor: NodeExecutor | undefined;
afterEach(() => {
  executor?.close();
  executor = undefined;
});

describe('a budget typed in another unit', () => {
  it('keeps the monthly figure for every reader, and what was typed beside it', async () => {
    const { database, ws } = await setupDb();
    const groceries = (await categoryIdsByKey(database, ws))['household.groceries']!;
    await saveBudget(database, ws, { categoryAccountId: groceries, amountMinor: 500_000, frequency: 'weekly' });
    expect((await listBudgets(database, ws, MONTH))[0]).toMatchObject({ planMinor: 2_166_667, amountMinor: 2_166_667, frequency: 'weekly', amountAsSetMinor: 500_000 });
  });

  it('counts cents in a dollar workspace', async () => {
    const { database, ws } = await setupDb('USD');
    const groceries = (await categoryIdsByKey(database, ws))['household.groceries']!;
    await saveBudget(database, ws, { categoryAccountId: groceries, amountMinor: 1_000, frequency: 'weekly' });
    expect((await listBudgets(database, ws, MONTH))[0]).toMatchObject({ planMinor: 4_333, amountAsSetMinor: 1_000 });
  });

  it('drops the unit when set monthly again', async () => {
    const { database, ws } = await setupDb();
    const groceries = (await categoryIdsByKey(database, ws))['household.groceries']!;
    await saveBudget(database, ws, { categoryAccountId: groceries, amountMinor: 2_400_000, frequency: 'yearly' });
    expect((await listBudgets(database, ws, MONTH))[0]).toMatchObject({ planMinor: 200_000, frequency: 'yearly' });

    await saveBudget(database, ws, { categoryAccountId: groceries, amountMinor: 900_000 });
    expect((await listBudgets(database, ws, MONTH))[0]).toMatchObject({ planMinor: 900_000, frequency: 'monthly', amountAsSetMinor: 900_000 });
  });

  it('refuses a line that comes to nothing a month, or a unit it does not know', async () => {
    const { database, ws } = await setupDb();
    const groceries = (await categoryIdsByKey(database, ws))['household.groceries']!;
    await expect(saveBudget(database, ws, { categoryAccountId: groceries, amountMinor: 5, frequency: 'yearly' })).rejects.toMatchObject({ code: 'AMOUNT_RANGE' });
    await expect(saveBudget(database, ws, { categoryAccountId: groceries, amountMinor: 5, frequency: 'fortnightly' as never })).rejects.toMatchObject({ code: 'BAD_FREQUENCY' });
  });

  it('still refuses what saveBudget always refused', async () => {
    const { database, ws } = await setupDb();
    const salary = (await categoryIdsByKey(database, ws))['income.salary']!;
    await expect(saveBudget(database, ws, { categoryAccountId: salary, amountMinor: 500_000, frequency: 'weekly' })).rejects.toMatchObject({ code: 'NOT_A_CATEGORY' });
  });

  it('keeps a month override monthly, whatever the plan’s unit', async () => {
    const { database, ws } = await setupDb();
    const groceries = (await categoryIdsByKey(database, ws))['household.groceries']!;
    await saveBudget(database, ws, { categoryAccountId: groceries, amountMinor: 500_000, frequency: 'weekly' });
    await setBudgetOverride(database, ws, { categoryAccountId: groceries, month: MONTH, amountMinor: 3_000_000 });
    expect((await listBudgets(database, ws, MONTH))[0]).toMatchObject({ planMinor: 2_166_667, amountMinor: 3_000_000, overridden: true, frequency: 'weekly' });
  });

  it('forgets the unit with the budget', async () => {
    const { database, ws } = await setupDb();
    const groceries = (await categoryIdsByKey(database, ws))['household.groceries']!;
    await saveBudget(database, ws, { categoryAccountId: groceries, amountMinor: 500_000, frequency: 'weekly' });
    await removeBudget(database, ws, groceries);
    await saveBudget(database, ws, { categoryAccountId: groceries, amountMinor: 900_000 });
    expect((await listBudgets(database, ws, MONTH))[0]).toMatchObject({ frequency: 'monthly', amountAsSetMinor: 900_000 });
  });

  it('converts the amount as typed when the workspace changes currency, and works the month out from it', async () => {
    // setBookBaseCurrency rewrites budgets.amount_minor; left alone, "Rp 500.000 a week" would read S$5.000,00 a week.
    const { database, ws } = await setupDb();
    const biz = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR' });
    const book = inBook(ws, biz);
    const software = await createAccount(database, book, { name: 'Software', kind: 'expense', subtype: 'category', currency: null });
    await saveBudget(database, book, { categoryAccountId: software.id, amountMinor: 500_000, frequency: 'weekly' });
    await upsertRate(database, { fromCurrency: 'IDR', toCurrency: 'SGD', onDate: isoDate(), rate: 0.000083, source: 'manual', sourceDate: isoDate() });
    await setBookBaseCurrency(database, ws, biz, 'SGD');
    // Rp 500.000 at 0,000083 is S$41,50 a week; 4.150 cents × 52 ÷ 12 = 17.983,33 → 17.983 a month.
    expect((await listBudgets(database, book, MONTH)).find((row) => row.categoryAccountId === software.id)).toMatchObject({ frequency: 'weekly', amountAsSetMinor: 4_150, planMinor: 17_983 });
  });

  it('turns a line monthly when the amount as typed would come to nothing in the new money', async () => {
    const { database, ws } = await setupDb();
    const biz = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR' });
    const book = inBook(ws, biz);
    const stamps = await createAccount(database, book, { name: 'Stamps', kind: 'expense', subtype: 'category', currency: null });
    // Rp 50 a day is Rp 1.521 a month (50 × 365 ÷ 12 = 1.520,83).
    await saveBudget(database, book, { categoryAccountId: stamps.id, amountMinor: 50, frequency: 'daily' });
    await upsertRate(database, { fromCurrency: 'IDR', toCurrency: 'SGD', onDate: isoDate(), rate: 0.000083, source: 'manual', sourceDate: isoDate() });
    await setBookBaseCurrency(database, ws, biz, 'SGD');
    // Rp 50 is 0,4 of a cent, so the day cannot be kept; the month, Rp 1.521, is 12,6 cents → 13.
    expect((await listBudgets(database, book, MONTH)).find((row) => row.categoryAccountId === stamps.id)).toMatchObject({ frequency: 'monthly', amountAsSetMinor: 13, planMinor: 13 });
  });

  it('stores the monthly figure alone on a database stopped before 0053', async () => {
    executor = createNodeExecutor();
    const database = createDatabase(executor);
    await migrate(database, MIGRATIONS.filter((m) => m.version <= 49));
    const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    const groceries = (await listAccounts(database, ws)).find((a) => a.systemKey === 'household.groceries')!.id;
    await saveBudget(database, ws, { categoryAccountId: groceries, amountMinor: 500_000, frequency: 'weekly' });
    expect((await listBudgets(database, ws, MONTH))[0]).toMatchObject({ planMinor: 2_166_667, frequency: 'monthly', amountAsSetMinor: 2_166_667 });
  });
});
