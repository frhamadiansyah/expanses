import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  categoryTotalsIn,
  createAccount,
  essentialSplitIn,
  getSpendingGuide,
  postTransaction,
  resetSpendingGuide,
  saveCategoryNeed,
  saveSpendingGuide,
  schema,
  SpendingGuideError,
} from '../src/index';
import type { Database, WorkspaceContext } from '../src/index';
import { setupDb } from './helpers';

async function categoryId(database: Database, ws: WorkspaceContext, name: string): Promise<string> {
  const [row] = await database.db
    .select({ id: schema.accounts.id })
    .from(schema.accounts)
    .where(and(eq(schema.accounts.workspaceId, ws.workspaceId), eq(schema.accounts.name, name)));
  return row!.id;
}

// Invented month: Rp 18.600.000 in, a restaurant bill with a refund, groceries, and a transfer between own accounts.
async function month() {
  const { database, ws } = await setupDb();
  const bank = await createAccount(database, ws, { name: 'Bank A', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const pot = await createAccount(database, ws, { name: 'Pot B', kind: 'asset', subtype: 'savings', currency: 'IDR' });
  const salary = await categoryId(database, ws, 'Salary');
  const restaurants = await categoryId(database, ws, 'Restaurants');
  const groceries = await categoryId(database, ws, 'Groceries');
  const pay = (on: string, description: string, category: string, amount: number) =>
    postTransaction(database, ws, {
      occurredOn: on,
      description,
      lines: [
        { accountId: category, amountMinor: amount, currency: 'IDR' },
        { accountId: bank.id, amountMinor: -amount, currency: 'IDR' },
      ],
    });
  await pay('2026-08-02', 'Pay', salary, -18_600_000);
  await pay('2026-08-04', 'Dinner', restaurants, 1_270_000);
  await pay('2026-08-06', 'Dinner refund', restaurants, -170_000);
  await pay('2026-08-08', 'Market', groceries, 2_340_000);
  await postTransaction(database, ws, {
    occurredOn: '2026-08-10',
    description: 'To the pot',
    lines: [
      { accountId: pot.id, amountMinor: 5_000_000, currency: 'IDR' },
      { accountId: bank.id, amountMinor: -5_000_000, currency: 'IDR' },
    ],
  });
  return { database, ws, restaurants, groceries };
}

describe('essentialSplitIn', () => {
  it('reads the same income and spending Cashflow’s rings read, split by each category’s mark', async () => {
    const { database, ws, restaurants } = await month();
    await saveCategoryNeed(database, ws, restaurants, 'lifestyle');

    const { split, currency } = await essentialSplitIn(database, ws, '2026-08-01', '2026-08-31', { excludeEvents: true });
    const spent = await categoryTotalsIn(database, ws, 'expense', '2026-08-01', '2026-08-31', { excludeEvents: true, billMonths: true });
    const earned = await categoryTotalsIn(database, ws, 'income', '2026-08-01', '2026-08-31', { excludeEvents: true, billMonths: true });

    expect(currency).toBe('IDR');
    expect(split.incomeMinor).toBe(earned.rows.reduce((sum, row) => sum + row.amountBaseMinor, 0));
    expect(split.spendingMinor).toBe(spent.rows.reduce((sum, row) => sum + row.amountBaseMinor, 0));
    // The refund nets against its own category; the move to the pot is no one's spending.
    expect(split.lifestyleMinor).toBe(1_100_000);
    expect(split.essentialMinor).toBe(2_340_000);
    expect(split.debtsSavingsMinor).toBe(18_600_000 - 1_100_000 - 2_340_000);
    expect(split.percents).toEqual({ essential: 13, lifestyle: 6, debtsSavings: 81 });
  });
});

describe('the spending guide', () => {
  it('reads 50 / 30 / 20 until one is saved, keeps it, and resets', async () => {
    const { database, ws } = await setupDb();
    expect(await getSpendingGuide(database, ws)).toEqual({ essential: 50, lifestyle: 30, debtsSavings: 20 });
    await saveSpendingGuide(database, ws, { essential: 60, lifestyle: 25, debtsSavings: 15 });
    expect(await getSpendingGuide(database, ws)).toEqual({ essential: 60, lifestyle: 25, debtsSavings: 15 });
    await resetSpendingGuide(database, ws);
    expect(await getSpendingGuide(database, ws)).toEqual({ essential: 50, lifestyle: 30, debtsSavings: 20 });
  });

  it('refuses three figures that do not add up to 100', async () => {
    const { database, ws } = await setupDb();
    await expect(saveSpendingGuide(database, ws, { essential: 60, lifestyle: 30, debtsSavings: 20 })).rejects.toBeInstanceOf(SpendingGuideError);
    expect(await getSpendingGuide(database, ws)).toEqual({ essential: 50, lifestyle: 30, debtsSavings: 20 });
  });

  it('keeps each open workspace to its own guide', async () => {
    const { database, ws } = await setupDb();
    const business = { ...ws, bookId: 'book-business' };
    await saveSpendingGuide(database, business, { essential: 40, lifestyle: 20, debtsSavings: 40 });
    expect(await getSpendingGuide(database, business)).toEqual({ essential: 40, lifestyle: 20, debtsSavings: 40 });
    expect(await getSpendingGuide(database, ws)).toEqual({ essential: 50, lifestyle: 30, debtsSavings: 20 });
  });
});
