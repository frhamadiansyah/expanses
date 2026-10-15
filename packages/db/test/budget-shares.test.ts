import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createAccount, listBudgets, removeBudget, saveBudget, saveBudgets, saveExpectedIncome, setBudgetOverride, setIncomeOverride } from '../src/index';
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

describe('saving a share', () => {
  it('keeps the share and the figure it came to, and saving an amount again clears the share', async () => {
    const { database, ws, food } = await withTree();
    await saveBudget(database, ws, { categoryAccountId: food.id, amountMinor: 3_000_000, share: { basis: 'take-home', bp: 3000 } });
    expect(capOf(await listBudgets(database, ws, '2026-10'), food.id)).toMatchObject({ amountMinor: 3_000_000, share: { basis: 'take-home', bp: 3000 } });

    await saveBudget(database, ws, { categoryAccountId: food.id, amountMinor: 2_500_000 });
    expect(capOf(await listBudgets(database, ws, '2026-10'), food.id)).toMatchObject({ amountMinor: 2_500_000, share: null });
  });

  it('refuses a % of take-home while there is no take-home, a % of a parent with no budget, a share out of range and a weekly share', async () => {
    const { database, ws, food, groceries } = await withTree();
    await expect(saveBudget(database, ws, { categoryAccountId: food.id, amountMinor: 0, share: { basis: 'take-home', bp: 3000 } })).rejects.toMatchObject({ code: 'NO_TAKE_HOME', message: 'Set a take-home first' });
    await expect(saveBudget(database, ws, { categoryAccountId: groceries.id, amountMinor: 100_000, share: { basis: 'parent', bp: 1000 } })).rejects.toMatchObject({ code: 'NO_PARENT_CAP' });
    await expect(saveBudget(database, ws, { categoryAccountId: food.id, amountMinor: 100_000, share: { basis: 'take-home', bp: 10001 } })).rejects.toMatchObject({ code: 'BAD_SHARE' });
    await expect(saveBudget(database, ws, { categoryAccountId: food.id, amountMinor: 100_000, frequency: 'weekly', share: { basis: 'take-home', bp: 100 } })).rejects.toMatchObject({ code: 'BAD_FREQUENCY' });
    expect(await listBudgets(database, ws, '2026-10')).toHaveLength(0);
  });

  it('accepts a % of a parent saved in the same go as the parent', async () => {
    const { database, ws, food, groceries } = await withTree();
    await saveBudgets(database, ws, {
      save: [
        { categoryAccountId: groceries.id, amountMinor: 800_000, share: { basis: 'parent', bp: 4000 } },
        { categoryAccountId: food.id, amountMinor: 2_000_000 },
      ],
      remove: [],
    });
    expect(capOf(await listBudgets(database, ws, '2026-10'), groceries.id).amountMinor).toBe(800_000);
  });

  it('turns a removed parent’s %-children into amounts at their figure now', async () => {
    const { database, ws, food, groceries } = await withTree();
    await saveBudget(database, ws, { categoryAccountId: food.id, amountMinor: 2_000_000 });
    await saveBudget(database, ws, { categoryAccountId: groceries.id, amountMinor: 800_000, share: { basis: 'parent', bp: 4000 } });

    await removeBudget(database, ws, food.id);
    expect(capOf(await listBudgets(database, ws, '2026-10'), groceries.id)).toMatchObject({ amountMinor: 800_000, share: null });
  });
});
