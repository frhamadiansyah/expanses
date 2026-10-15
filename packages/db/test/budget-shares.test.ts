import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createAccount, listBudgets, saveBudget, saveExpectedIncome, setBudgetOverride, setIncomeOverride } from '../src/index';
import { setupDb } from './helpers';

async function withTree() {
  const { database, ws } = await setupDb();
  const food = await createAccount(database, ws, { name: 'Food', kind: 'expense', subtype: 'category', currency: null });
  const groceries = await createAccount(database, ws, { name: 'Groceries', kind: 'expense', subtype: 'category', currency: null, parentId: food.id });
  await saveExpectedIncome(database, ws, 10_000_000);
  return { database, ws, food, groceries };
}

type Db = Awaited<ReturnType<typeof setupDb>>['database'];

async function makeShare(database: Db, ws: { workspaceId: string }, budgetId: string, basis: string, bp: number) {
  await database.db.run(sql`INSERT INTO budget_shares VALUES (${budgetId}, ${ws.workspaceId}, ${basis}, ${bp})`);
}

const capOf = (rows: Awaited<ReturnType<typeof listBudgets>>, id: string) => rows.find((row) => row.categoryAccountId === id)!;

describe('listBudgets with shares', () => {
  it('reads a % of take-home and a % of its parent as the month’s figures, and names the share', async () => {
    const { database, ws, food, groceries } = await withTree();
    const foodId = await saveBudget(database, ws, { categoryAccountId: food.id, amountMinor: 1 });
    const groceriesId = await saveBudget(database, ws, { categoryAccountId: groceries.id, amountMinor: 1 });
    await makeShare(database, ws, foodId, 'take-home', 3000);
    await makeShare(database, ws, groceriesId, 'parent', 4000);

    const rows = await listBudgets(database, ws, '2026-10');
    expect(capOf(rows, food.id)).toMatchObject({ planMinor: 3_000_000, amountMinor: 3_000_000, share: { basis: 'take-home', bp: 3000 } });
    expect(capOf(rows, groceries.id)).toMatchObject({ amountMinor: 1_200_000, share: { basis: 'parent', bp: 4000 } });
  });

  it('follows a month with its own take-home, and leaves the next month on the usual one', async () => {
    const { database, ws, food } = await withTree();
    const foodId = await saveBudget(database, ws, { categoryAccountId: food.id, amountMinor: 1 });
    await makeShare(database, ws, foodId, 'take-home', 3000);
    await setIncomeOverride(database, ws, { month: '2026-12', amountMinor: 20_000_000 });

    expect(capOf(await listBudgets(database, ws, '2026-12'), food.id).amountMinor).toBe(6_000_000);
    expect(capOf(await listBudgets(database, ws, '2027-01'), food.id).amountMinor).toBe(3_000_000);
  });

  it('lets a month’s own figure for a % budget win', async () => {
    const { database, ws, food } = await withTree();
    const foodId = await saveBudget(database, ws, { categoryAccountId: food.id, amountMinor: 1 });
    await makeShare(database, ws, foodId, 'take-home', 3000);
    await setBudgetOverride(database, ws, { categoryAccountId: food.id, month: '2026-10', amountMinor: 4_000_000 });
    expect(capOf(await listBudgets(database, ws, '2026-10'), food.id)).toMatchObject({ planMinor: 3_000_000, amountMinor: 4_000_000, overridden: true });
  });

  it('gives an amount budget no share, and a % of take-home nothing when there is no take-home', async () => {
    const { database, ws, food, groceries } = await withTree();
    await saveExpectedIncome(database, ws, 0);
    const foodId = await saveBudget(database, ws, { categoryAccountId: food.id, amountMinor: 1 });
    await saveBudget(database, ws, { categoryAccountId: groceries.id, amountMinor: 250_000 });
    await makeShare(database, ws, foodId, 'take-home', 3000);
    const rows = await listBudgets(database, ws, '2026-10');
    expect(capOf(rows, food.id).amountMinor).toBe(0);
    expect(capOf(rows, groceries.id)).toMatchObject({ amountMinor: 250_000, share: null });
  });
});
