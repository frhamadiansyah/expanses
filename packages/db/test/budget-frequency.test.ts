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

  it('re-saving an existing monthly line as weekly stores the month worked out, not the figure as typed', async () => {
    const { database, ws } = await setupDb();
    const groceries = (await categoryIdsByKey(database, ws))['household.groceries']!;
    await saveBudget(database, ws, { categoryAccountId: groceries, amountMinor: 2_000_000 });
    expect((await listBudgets(database, ws, MONTH))[0]).toMatchObject({ planMinor: 2_000_000, frequency: 'monthly' });

    await saveBudget(database, ws, { categoryAccountId: groceries, amountMinor: 500_000, frequency: 'weekly' });
    // The update branch must write the worked-out month, not the Rp 500.000 as typed: that would leave
    // every cap reader thinking groceries costs Rp 500.000 a month, not Rp 2.166.667.
    expect((await listBudgets(database, ws, MONTH))[0]).toMatchObject({ planMinor: 2_166_667, amountMinor: 2_166_667, frequency: 'weekly', amountAsSetMinor: 500_000 });
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

  it('converts the amount as typed and works the month out from it, even where the two routes disagree', async () => {
    // At IDR→SGD 0,000083 above, converting the typed figure and converting the stored month happen to land on
    // the same 17.983 cents, so that test alone cannot tell the two routes apart. USD→IDR at 16.000 can: this is
    // the review's own discriminating fixture.
    const { database, ws } = await setupDb();
    const biz = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'USD' });
    const book = inBook(ws, biz);
    const software = await createAccount(database, book, { name: 'Software', kind: 'expense', subtype: 'category', currency: null });
    // US$41,50 a week.
    await saveBudget(database, book, { categoryAccountId: software.id, amountMinor: 4_150, frequency: 'weekly' });
    await upsertRate(database, { fromCurrency: 'USD', toCurrency: 'IDR', onDate: isoDate(), rate: 16_000, source: 'manual', sourceDate: isoDate() });
    await setBookBaseCurrency(database, ws, biz, 'IDR');
    // US$41,50 at 16.000 converts once to Rp 664.000, then 52 ÷ 12 gives Rp 2.877.333 a month. Converting the old
    // monthly figure (US$179,83 → 17.983 cents) directly instead would give Rp 2.877.280 — a different figure.
    expect((await listBudgets(database, book, MONTH)).find((row) => row.categoryAccountId === software.id)).toMatchObject({
      frequency: 'weekly',
      amountAsSetMinor: 664_000,
      planMinor: 2_877_333,
    });
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

  it('refuses the change, naming the line, when a typed amount survives but its month comes to nothing', async () => {
    const { database, ws } = await setupDb();
    const biz = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR' });
    const book = inBook(ws, biz);
    const stamps = await createAccount(database, book, { name: 'Stamps', kind: 'expense', subtype: 'category', currency: null });
    // Rp 160 a quarter is 1,3 cents → 1 cent, which survives; 1 cent a quarter is 0,33 of a cent a month → 0,
    // which budgets.amount_minor > 0 refuses. A refusal that names the line, never a raw SQLite error.
    await saveBudget(database, book, { categoryAccountId: stamps.id, amountMinor: 160, frequency: 'quarterly' });
    await upsertRate(database, { fromCurrency: 'IDR', toCurrency: 'SGD', onDate: isoDate(), rate: 0.000083, source: 'manual', sourceDate: isoDate() });
    await expect(setBookBaseCurrency(database, ws, biz, 'SGD')).rejects.toMatchObject({ name: 'BookError', code: 'CAP_TOO_SMALL', message: expect.stringContaining('Stamps') });
    // Nothing moved: the whole change is one transaction.
    expect((await listBudgets(database, book, MONTH)).find((row) => row.categoryAccountId === stamps.id)).toMatchObject({ frequency: 'quarterly', amountAsSetMinor: 160 });
  });

  it('refuses the change, naming the line, when a monthly cap comes to nothing in the new money', async () => {
    const { database, ws } = await setupDb();
    const biz = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR' });
    const book = inBook(ws, biz);
    const stamps = await createAccount(database, book, { name: 'Stamps', kind: 'expense', subtype: 'category', currency: null });
    // Rp 50 a month is 0,4 of a cent → 0.
    await saveBudget(database, book, { categoryAccountId: stamps.id, amountMinor: 50 });
    await upsertRate(database, { fromCurrency: 'IDR', toCurrency: 'SGD', onDate: isoDate(), rate: 0.000083, source: 'manual', sourceDate: isoDate() });
    await expect(setBookBaseCurrency(database, ws, biz, 'SGD')).rejects.toMatchObject({ name: 'BookError', code: 'CAP_TOO_SMALL', message: expect.stringContaining('Stamps') });
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

  it('removes a budget and changes a book’s currency on a database stopped before 0053, without the health tables', async () => {
    executor = createNodeExecutor();
    const database = createDatabase(executor);
    await migrate(database, MIGRATIONS.filter((m) => m.version <= 49));
    const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    const biz = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR' });
    const book = inBook(ws, biz);
    const software = await createAccount(database, book, { name: 'Software', kind: 'expense', subtype: 'category', currency: null });
    await saveBudget(database, book, { categoryAccountId: software.id, amountMinor: 500_000 });
    await upsertRate(database, { fromCurrency: 'IDR', toCurrency: 'SGD', onDate: isoDate(), rate: 0.000083, source: 'manual', sourceDate: isoDate() });

    // Neither call may throw "no such table: budget_frequencies" — the guard each one carries must hold
    // on a database this old, exactly as it does for save and list.
    await expect(setBookBaseCurrency(database, ws, biz, 'SGD')).resolves.toMatchObject({ rate: 0.000083 });
    await expect(removeBudget(database, book, software.id)).resolves.toBeUndefined();
    expect(await listBudgets(database, book, MONTH)).toEqual([]);
  });
});
