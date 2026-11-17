import { CARD_CASHBACK, expenseLines, incomeLines, refundLines, statementCycleFor } from '@expanses/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  budgetSheetFor,
  cardCashbackCategory,
  cardSpendLines,
  cardStatement,
  categoryTotalsIn,
  createAccount,
  createBook,
  essentialSplitIn,
  guessCategoryFromHistory,
  listAccounts,
  nativeBalances,
  periodFlows,
  postTransaction,
  saveBudget,
  saveCardTerms,
  saveCategoryNeed,
} from '../src/index';
import { setupDb, type TestDb } from './helpers';

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

/**
 * Invented figures: BCA Visa, statement on the 25th; Rp 320.000 at the supermarket on 10 November and a Rp 75.000 promo
 * cashback onto the same card on 17 November; Rp 1.000.000 of salary into the bank.
 */
async function november() {
  current = await setupDb();
  const { database, ws } = current;
  const bank = (await createAccount(database, ws, { name: 'Bank', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 5_000_000 })).id;
  const card = (await createAccount(database, ws, { name: 'BCA Visa', kind: 'liability', subtype: 'credit_card', currency: 'IDR' })).id;
  await saveCardTerms(database, ws, { accountId: card, statementDay: 25, dueDay: 10, creditLimitMinor: null, annualFeeMinor: 0 });
  const all = await listAccounts(database, ws);
  const groceries = all.find((a) => a.systemKey === 'household.groceries')!.id;
  const salary = all.find((a) => a.systemKey === 'income.salary')!.id;
  await postTransaction(database, ws, { occurredOn: '2026-11-01', description: 'Salary', lines: incomeLines({ incomeAccountId: salary, depositAccountId: bank, amountMinor: 1_000_000, currency: 'IDR' }) });
  await postTransaction(database, ws, { occurredOn: '2026-11-10', description: 'Supermarket', lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: card, amountMinor: 320_000, currency: 'IDR' }) });
  const cashback = await cardCashbackCategory(database, ws);
  await postTransaction(database, ws, { occurredOn: '2026-11-17', description: 'Promo cashback', lines: refundLines({ categoryAccountId: cashback, paymentAccountId: card, amountMinor: 75_000, currency: 'IDR' }) });
  return { database, ws, bank, card, groceries, salary, cashback };
}

describe('Cashback & Rewards into a credit card', () => {
  it('is made once, at the top of the spending tree, keyed, and reused', async () => {
    const { database, ws, cashback } = await november();
    expect(await cardCashbackCategory(database, ws)).toBe(cashback);
    const made = (await listAccounts(database, ws)).filter((a) => a.systemKey === CARD_CASHBACK.key);
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ id: cashback, kind: 'expense', subtype: 'category', name: 'Cashback & Rewards', parentId: null });
  });

  it('is made in the open workspace, never borrowed from another', async () => {
    const { database, ws, cashback } = await november();
    const business = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR' });
    const there = await cardCashbackCategory(database, { ...ws, bookId: business });
    expect(there).not.toBe(cashback);
    expect(await cardCashbackCategory(database, { ...ws, bookId: business })).toBe(there);
  });

  it('lowers what the card owes, and the statement shows it as a credit, the bill Rp 245.000', async () => {
    const { database, ws, card } = await november();
    expect((await nativeBalances(database, ws))[card]).toBe(-245_000);
    const statement = await cardStatement(database, ws, card, statementCycleFor('2026-11-25', 25), '2026-11-26');
    expect(statement).toMatchObject({ chargesMinor: 320_000, creditsMinor: 75_000, closingMinor: 245_000, leftToPayMinor: 245_000 });
    expect(statement.lines.map((line) => [line.description, line.owedMinor])).toEqual([
      ['Supermarket', 320_000],
      ['Promo cashback', -75_000],
    ]);
  });

  it('lowers the month’s total spending to Rp 245.000, keeps Groceries at Rp 320.000 and adds nothing to income', async () => {
    const { database, ws, groceries, cashback } = await november();
    const spending = await categoryTotalsIn(database, ws, 'expense', '2026-11-01', '2026-11-30');
    expect(spending.rows.find((row) => row.accountId === groceries)?.amountBaseMinor).toBe(320_000);
    expect(spending.rows.find((row) => row.accountId === cashback)?.amountBaseMinor).toBe(-75_000);
    expect(spending.rows.reduce((sum, row) => sum + row.amountBaseMinor, 0)).toBe(245_000);
    const income = await categoryTotalsIn(database, ws, 'income', '2026-11-01', '2026-11-30');
    expect(income.rows.map((row) => row.amountBaseMinor)).toEqual([1_000_000]);
    const flows = await periodFlows(database, ws, { from: '2026-11-01', to: '2026-11-30' });
    expect(flows).toMatchObject({ incomeMinor: 1_000_000, spendingMinor: 245_000, lifestyleSpendingMinor: 0 });
  });

  it('leaves the budget for Groceries counting Rp 320.000, with no line of its own, and lowers what was spent', async () => {
    const { database, ws, groceries, cashback } = await november();
    await saveBudget(database, ws, { categoryAccountId: groceries, amountMinor: 400_000 });
    const sheet = await budgetSheetFor(database, ws, '2026-11');
    const household = sheet.lines.find((line) => line.children.some((child) => child.id === groceries))!;
    expect(household.children.find((child) => child.id === groceries)).toMatchObject({ totalMinor: 320_000, capMinor: 400_000, overMinor: 0 });
    const ids = (lines: typeof sheet.lines): string[] => lines.flatMap((line) => [line.id, ...ids(line.children)]);
    expect(ids(sheet.lines)).not.toContain(cashback);
    expect(sheet.spendingActualMinor).toBe(245_000);
    expect(sheet.essentialActualMinor).toBe(320_000);
    expect(sheet.debtsSavingsActualMinor).toBe(-75_000);
  });

  it('takes no budget and no mark of its own', async () => {
    const { database, ws, cashback } = await november();
    await expect(saveBudget(database, ws, { categoryAccountId: cashback, amountMinor: 10_000 })).rejects.toMatchObject({ code: 'NOT_A_CATEGORY' });
    await expect(saveCategoryNeed(database, ws, cashback, 'lifestyle')).rejects.toMatchObject({ code: 'NOT_A_CATEGORY' });
  });

  it('is neither Essential nor Lifestyle on Cashflow’s split, and the three still add up to the income', async () => {
    const { database, ws } = await november();
    const { split } = await essentialSplitIn(database, ws, '2026-11-01', '2026-11-30', { excludeEvents: false });
    expect(split).toMatchObject({ incomeMinor: 1_000_000, spendingMinor: 245_000, essentialMinor: 320_000, lifestyleMinor: 0, debtsSavingsMinor: 680_000 });
    expect(split.essentialMinor + split.lifestyleMinor + split.debtsSavingsMinor).toBe(split.incomeMinor);
  });

  it('earns no points and takes none back: it is no purchase and no refund of one', async () => {
    const { database, ws, card } = await november();
    const lines = await cardSpendLines(database, ws, card, '2026-10-26', '2026-11-25');
    expect(lines.map((line) => [line.description, line.amountMinor])).toEqual([['Supermarket', 320_000]]);
  });

  it('is never guessed from a note: a purchase with the same words is no cashback', async () => {
    const { database, ws } = await november();
    expect(await guessCategoryFromHistory(database, ws, 'Promo cashback')).toBeNull();
  });
});
