import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { BudgetError, createAccount, healthSchema, listBudgets, removeBudget, saveBudget, clearBudgetOverride, setBudgetOverride } from '../src/index';
import { setupDb } from './helpers';

async function withCategories() {
  const { database, ws } = await setupDb();
  const food = await createAccount(database, ws, { name: 'Food', kind: 'expense', subtype: 'category', currency: null });
  const coffee = await createAccount(database, ws, { name: 'Coffee', kind: 'expense', subtype: 'category', currency: null, parentId: food.id });
  return { database, ws, food, coffee };
}

const capOf = (rows: Awaited<ReturnType<typeof listBudgets>>, categoryId: string) => rows.find((row) => row.categoryAccountId === categoryId);

describe('budgets', () => {
  it('gives a category one budget, and saving again replaces it', async () => {
    const { database, ws, food } = await withCategories();

    await saveBudget(database, ws, { categoryAccountId: food.id, amountMinor: 5_000_000 });
    await saveBudget(database, ws, { categoryAccountId: food.id, amountMinor: 6_000_000 });

    const rows = await listBudgets(database, ws, '2026-09');
    expect(rows).toHaveLength(1);
    expect(capOf(rows, food.id)).toMatchObject({ amountMinor: 6_000_000, planMinor: 6_000_000, overridden: false });
  });

  it('refuses a budget on an account that is not a category', async () => {
    const { database, ws } = await withCategories();
    const bca = await createAccount(database, ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR' });

    await expect(saveBudget(database, ws, { categoryAccountId: bca.id, amountMinor: 1_000_000 })).rejects.toThrow(BudgetError);
  });

  it('refuses a cap of nothing, which is a removal rather than a budget', async () => {
    const { database, ws, food } = await withCategories();

    await expect(saveBudget(database, ws, { categoryAccountId: food.id, amountMinor: 0 })).rejects.toThrow(BudgetError);
  });

  it('lets a child carry its own tighter budget', async () => {
    const { database, ws, food, coffee } = await withCategories();

    await saveBudget(database, ws, { categoryAccountId: food.id, amountMinor: 5_000_000 });
    await saveBudget(database, ws, { categoryAccountId: coffee.id, amountMinor: 500_000 });

    expect(await listBudgets(database, ws, '2026-09')).toHaveLength(2);
  });
});

describe('overrides', () => {
  it('applies to its own month and leaves the next alone', async () => {
    const { database, ws, food } = await withCategories();
    await saveBudget(database, ws, { categoryAccountId: food.id, amountMinor: 5_000_000 });

    await setBudgetOverride(database, ws, { categoryAccountId: food.id, month: '2026-12', amountMinor: 9_000_000 });

    expect(capOf(await listBudgets(database, ws, '2026-12'), food.id)).toMatchObject({ amountMinor: 9_000_000, planMinor: 5_000_000, overridden: true });
    expect(capOf(await listBudgets(database, ws, '2027-01'), food.id)).toMatchObject({ amountMinor: 5_000_000, overridden: false });
  });

  it('replaces an override for the same month rather than adding another', async () => {
    const { database, ws, food } = await withCategories();
    await saveBudget(database, ws, { categoryAccountId: food.id, amountMinor: 5_000_000 });

    await setBudgetOverride(database, ws, { categoryAccountId: food.id, month: '2026-12', amountMinor: 9_000_000 });
    await setBudgetOverride(database, ws, { categoryAccountId: food.id, month: '2026-12', amountMinor: 8_000_000 });

    expect(capOf(await listBudgets(database, ws, '2026-12'), food.id)).toMatchObject({ amountMinor: 8_000_000 });
  });

  it('takes nothing this month as a real answer', async () => {
    const { database, ws, food } = await withCategories();
    await saveBudget(database, ws, { categoryAccountId: food.id, amountMinor: 5_000_000 });

    await setBudgetOverride(database, ws, { categoryAccountId: food.id, month: '2026-12', amountMinor: 0 });

    expect(capOf(await listBudgets(database, ws, '2026-12'), food.id)).toMatchObject({ amountMinor: 0, overridden: true });
  });

  it('brings the plan back when the override is cleared', async () => {
    const { database, ws, food } = await withCategories();
    await saveBudget(database, ws, { categoryAccountId: food.id, amountMinor: 5_000_000 });
    await setBudgetOverride(database, ws, { categoryAccountId: food.id, month: '2026-12', amountMinor: 9_000_000 });

    await clearBudgetOverride(database, ws, food.id, '2026-12');

    expect(capOf(await listBudgets(database, ws, '2026-12'), food.id)).toMatchObject({ amountMinor: 5_000_000, overridden: false });
  });

  it('refuses a month that is not a month', async () => {
    const { database, ws, food } = await withCategories();
    await saveBudget(database, ws, { categoryAccountId: food.id, amountMinor: 5_000_000 });

    await expect(setBudgetOverride(database, ws, { categoryAccountId: food.id, month: '2026-9', amountMinor: 1 })).rejects.toThrow(BudgetError);
  });
});

describe('removing a budget', () => {
  it('takes its overrides with it', async () => {
    const { database, ws, food } = await withCategories();
    await saveBudget(database, ws, { categoryAccountId: food.id, amountMinor: 5_000_000 });
    await setBudgetOverride(database, ws, { categoryAccountId: food.id, month: '2026-12', amountMinor: 9_000_000 });

    await removeBudget(database, ws, food.id);

    expect(await listBudgets(database, ws, '2026-12')).toEqual([]);
  });

  it('takes its frequency row with it too, leaving no orphan behind', async () => {
    const { database, ws, food } = await withCategories();
    await saveBudget(database, ws, { categoryAccountId: food.id, amountMinor: 500_000, frequency: 'weekly' });
    const [before] = await database.db.select().from(healthSchema.budgetFrequencies).where(eq(healthSchema.budgetFrequencies.workspaceId, ws.workspaceId));
    expect(before).toBeDefined();

    await removeBudget(database, ws, food.id);

    const rows = await database.db.select().from(healthSchema.budgetFrequencies).where(eq(healthSchema.budgetFrequencies.workspaceId, ws.workspaceId));
    expect(rows).toEqual([]);
  });
});
