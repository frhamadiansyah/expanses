import { isoDate } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import {
  budgetSheetFor,
  committedByCategory,
  createAccount,
  createBook,
  eventSpendingBetween,
  inBook,
  listTransactionsIn,
  periodFlows,
  personalBook,
  postTransaction,
  saveEarmark,
  saveEvent,
  saveExpenseTemplate,
  saveGoal,
  tagTransaction,
  upsertRate,
  type WorkspaceContext,
  type Database,
} from '../src/index';
import { setupDb } from './helpers';

const MONTH = '2026-09';
const RANGE = { from: '2026-09-01', to: '2026-09-30' };
/** 12.000.000 rupiah at 0,000083 is S$996,00 — rupiah has no minor units and the dollar has two. */
const RATE = 0.000083;

/**
 * An owner in rupiah with a second workspace that keeps its books in Singapore dollars, and one rate, from the
 * first of the month. Rates are read one way only, so a workspace in SGD needs IDR→SGD rows: anything asked for
 * before that first rate, or in a currency with no row at all, has no answer and must be left out and named.
 */
async function sgdWorkspace() {
  const { database, ws } = await setupDb();
  const sgd = await createBook(database, ws, { name: 'Singapore', kind: 'business', baseCurrency: 'SGD' });
  const book = inBook(ws, sgd);
  await upsertRate(database, { fromCurrency: 'IDR', toCurrency: 'SGD', onDate: '2026-09-01', rate: RATE, source: 'manual', sourceDate: '2026-09-01' });
  const card = await createAccount(database, ws, { name: 'KrisFlyer', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  const meals = await createAccount(database, book, { name: 'Client meals', kind: 'expense', subtype: 'category', currency: null });
  return { database, ws, sgd, book, card, meals };
}

const spend = (
  database: Database,
  ws: WorkspaceContext,
  input: { categoryId: string; payerId: string; occurredOn: string; amountMinor: number; currency?: string; ratesToBase?: Record<string, number> },
) =>
  postTransaction(database, ws, {
    occurredOn: input.occurredOn,
    description: 'Dinner',
    ratesToBase: input.ratesToBase,
    lines: [
      { accountId: input.categoryId, amountMinor: input.amountMinor, currency: input.currency ?? 'IDR' },
      { accountId: input.payerId, amountMinor: -input.amountMinor, currency: input.currency ?? 'IDR' },
    ],
  });

describe('the budget sheet of a workspace that reads in its own currency', () => {
  it('reads its month, its goals and what it left out in that currency', async () => {
    const { database, ws, book, card, meals } = await sgdWorkspace();
    // A dollar card: no USD→SGD rate exists at all, so what it paid for cannot be counted.
    const amex = await createAccount(database, ws, { name: 'Amex USD', kind: 'liability', subtype: 'credit_card', currency: 'USD' });
    await spend(database, book, { categoryId: meals.id, payerId: card.id, occurredOn: '2026-09-10', amountMinor: 12_000_000 });
    await spend(database, book, { categoryId: meals.id, payerId: amex.id, occurredOn: '2026-09-12', amountMinor: 40_000, currency: 'USD', ratesToBase: { USD: 16_000 } });

    // A goal and a set-aside are the owner's, kept in rupiah; the sheet converts them at the month's last day.
    const pot = await createAccount(database, ws, { name: 'Savings pot', kind: 'asset', subtype: 'savings', currency: 'IDR' });
    const goalId = await saveGoal(database, ws, {
      name: 'Emergency fund',
      kind: 'emergency',
      growthBps: 0,
      returnBps: 200,
      stages: [{ name: 'Emergency fund', targetMinor: 60_000_000, targetMonths: null, dueOn: '2027-09-30' }],
    });
    await saveEarmark(database, ws, { goalId, accountId: pot.id, amountMinor: 2_000_000 });

    const sheet = await budgetSheetFor(database, book, MONTH);

    expect(sheet.currency).toBe('SGD');
    // S$996,00 — the dollar purchase is not in it, and is named instead of being guessed at.
    expect(sheet.lines.find((line) => line.name === 'Client meals')?.totalMinor).toBe(99_600);
    expect(sheet.unconverted).toEqual([{ currency: 'USD', onDate: '2026-09-12' }]);
    // 2.000.000 rupiah set aside, at the last day of September's rate: S$166,00.
    expect(sheet.savings.find((row) => row.goalId === goalId)?.actualMinor).toBe(16_600);
  });

  it('says nothing about currencies when the workspace reads in the owner’s own', async () => {
    const { database, ws } = await setupDb();
    const bca = await createAccount(database, ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    const personal = await personalBook(database, ws);
    const groceries = await createAccount(database, inBook(ws, personal.id), { name: 'Groceries', kind: 'expense', subtype: 'category', currency: null });
    await spend(database, inBook(ws, personal.id), { categoryId: groceries.id, payerId: bca.id, occurredOn: '2026-09-05', amountMinor: 5_000_000 });

    const sheet = await budgetSheetFor(database, inBook(ws, personal.id), MONTH);

    expect(sheet.currency).toBe('IDR');
    expect(sheet.unconverted).toEqual([]);
    expect(sheet.lines.find((line) => line.name === 'Groceries')?.totalMinor).toBe(5_000_000);
  });
});

describe('the flows a workspace reads', () => {
  it('counts only its own income and spending, and counts it in its own currency', async () => {
    const { database, ws, book, card, meals } = await sgdWorkspace();
    const bca = await createAccount(database, ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    const personal = inBook(ws, (await personalBook(database, ws)).id);
    const groceries = await createAccount(database, personal, { name: 'Groceries', kind: 'expense', subtype: 'category', currency: null });
    const salary = await createAccount(database, personal, { name: 'Salary', kind: 'income', subtype: 'category', currency: null });

    await spend(database, book, { categoryId: meals.id, payerId: card.id, occurredOn: '2026-09-10', amountMinor: 12_000_000 });
    await spend(database, personal, { categoryId: groceries.id, payerId: bca.id, occurredOn: '2026-09-05', amountMinor: 5_000_000 });
    await postTransaction(database, personal, {
      occurredOn: '2026-09-25',
      description: 'Salary',
      lines: [
        { accountId: bca.id, amountMinor: 20_000_000, currency: 'IDR' },
        { accountId: salary.id, amountMinor: -20_000_000, currency: 'IDR' },
      ],
    });

    const singapore = await periodFlows(database, book, RANGE);
    expect(singapore.currency).toBe('SGD');
    // Only its own dinner, converted: the household's groceries are Personal's, and would have read as S$415 more.
    expect(singapore.spendingMinor).toBe(99_600);
    // …and the household's salary is Personal's income, not this workspace's.
    expect(singapore.incomeMinor).toBe(0);

    const household = await periodFlows(database, personal, RANGE);
    expect(household.currency).toBe('IDR');
    expect(household.spendingMinor).toBe(5_000_000);
    expect(household.incomeMinor).toBe(20_000_000);
    expect(household.missing).toEqual([]);
  });
});

describe('what a workspace’s bills already claim', () => {
  it('converts each bill from the money that pays it, and names the one it could not', async () => {
    const { database, ws, book, card, meals } = await sgdWorkspace();
    const amex = await createAccount(database, ws, { name: 'Amex USD', kind: 'liability', subtype: 'credit_card', currency: 'USD' });
    await saveExpenseTemplate(database, book, { name: 'Co-working', categoryAccountId: meals.id, moneyAccountId: card.id, amountMinor: 500_000, dayOfMonth: 5 });

    // 500.000 rupiah at 0,000083 is S$41,50 — not five hundred thousand dollars.
    expect(await committedByCategory(database, book)).toEqual({ committed: { [meals.id]: 4_150 }, currency: 'SGD', missing: [] });

    await saveExpenseTemplate(database, book, { name: 'Figma', categoryAccountId: meals.id, moneyAccountId: amex.id, amountMinor: 4_500, dayOfMonth: 8 });

    const after = await committedByCategory(database, book);
    // The dollar bill is left out of the figure rather than added as though it were rupiah — and is said out loud,
    // so "… of it is bills" cannot understate what is already spoken for without the page knowing.
    expect(after.committed).toEqual({ [meals.id]: 4_150 });
    expect(after.missing).toEqual([{ currency: 'USD', onDate: isoDate() }]);
  });
});

describe('an event and a list read in the workspace’s currency', () => {
  it('adds up the event in that currency, and leaves out what predates every rate', async () => {
    const { database, ws, book, card, meals } = await sgdWorkspace();
    const eventId = await saveEvent(database, ws, { name: 'Client visit', startsOn: '2026-08-01', endsOn: '2026-09-30' });
    const inSeptember = await spend(database, book, { categoryId: meals.id, payerId: card.id, occurredOn: '2026-09-10', amountMinor: 12_000_000 });
    const inAugust = await spend(database, book, { categoryId: meals.id, payerId: card.id, occurredOn: '2026-08-10', amountMinor: 6_000_000 });
    await tagTransaction(database, ws, inSeptember, eventId);
    await tagTransaction(database, ws, inAugust, eventId);

    const event = await eventSpendingBetween(database, book, '2026-08-01', '2026-09-30');
    expect(event).toEqual({ amountMinor: 99_600, currency: 'SGD', missing: [{ currency: 'IDR', onDate: '2026-08-10' }] });

    const list = await listTransactionsIn(database, book, { from: '2026-08-01', to: '2026-09-30' });
    expect(list.currency).toBe('SGD');
    expect(list.missing).toEqual([{ currency: 'IDR', onDate: '2026-08-10' }]);
    // The August purchase counts as nothing in the day's total, and still says what was actually paid.
    const august = list.transactions.find((tx) => tx.id === inAugust)!.entries.find((entry) => entry.accountId === meals.id)!;
    expect(august).toMatchObject({ amountBaseMinor: 0, amountMinor: 6_000_000, currency: 'IDR' });
    const september = list.transactions.find((tx) => tx.id === inSeptember)!.entries.find((entry) => entry.accountId === meals.id)!;
    expect(september).toMatchObject({ amountBaseMinor: 99_600, amountMinor: 12_000_000 });
  });
});
