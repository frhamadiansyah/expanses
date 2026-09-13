import { eq, and } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { budgetSheetFor, createAccount, postTransaction, saveBudget, saveExpectedIncome, saveGoal, schema } from '../src/index';
import { setupDb } from './helpers';
import type { Database } from '../src/index';
import type { WorkspaceContext } from '../src/index';

const MONTH = '2026-09';

/** The seeded tree already holds these, so the sheet is tested against what a real workspace has. */
async function categoryId(database: Database, ws: WorkspaceContext, name: string): Promise<string> {
  const [row] = await database.db
    .select({ id: schema.accounts.id })
    .from(schema.accounts)
    .where(and(eq(schema.accounts.workspaceId, ws.workspaceId), eq(schema.accounts.name, name)));
  return row!.id;
}

async function workspaceWithSpending() {
  const { database, ws } = await setupDb();
  const bca = await createAccount(database, ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const groceries = await categoryId(database, ws, 'Groceries');
  const salary = await categoryId(database, ws, 'Salary');

  await postTransaction(database, ws, {
    occurredOn: '2026-09-05',
    description: 'Salary',
    lines: [
      { accountId: bca.id, amountMinor: 20_000_000, currency: 'IDR' },
      { accountId: salary, amountMinor: -20_000_000, currency: 'IDR' },
    ],
  });
  await postTransaction(database, ws, {
    occurredOn: '2026-09-09',
    description: 'Superindo',
    lines: [
      { accountId: groceries, amountMinor: 500_000, currency: 'IDR' },
      { accountId: bca.id, amountMinor: -500_000, currency: 'IDR' },
    ],
  });
  return { database, ws, bca };
}

describe('the assembled sheet', () => {
  it('reads what was actually earned from the ledger', async () => {
    const { database, ws } = await workspaceWithSpending();

    const sheet = await budgetSheetFor(database, ws, MONTH);

    expect(sheet.incomeActualMinor).toBe(20_000_000);
  });

  it('takes the plan from what the owner typed, not from the ledger', async () => {
    const { database, ws } = await workspaceWithSpending();
    await saveExpectedIncome(database, ws, 25_000_000);

    const sheet = await budgetSheetFor(database, ws, MONTH);

    expect(sheet.incomePlanMinor).toBe(25_000_000);
    expect(sheet.incomeActualMinor).toBe(20_000_000);
  });

  it('counts a child category against a cap on its parent', async () => {
    const { database, ws } = await workspaceWithSpending();
    await saveBudget(database, ws, { categoryAccountId: await categoryId(database, ws, 'Food & Drink'), amountMinor: 300_000 });

    const sheet = await budgetSheetFor(database, ws, MONTH);
    const food = sheet.lines.find((line) => line.name === 'Food & Drink')!;

    expect(food.totalMinor).toBe(500_000);
    expect(food.overMinor).toBe(200_000);
    expect(sheet.overCount).toBe(1);
  });

  it('gives every goal a savings row, with nothing saved until contributions are recorded', async () => {
    const { database, ws } = await workspaceWithSpending();
    await saveGoal(database, ws, {
      name: 'Emergency fund',
      kind: 'emergency',
      growthBps: 0,
      returnBps: 200,
      stages: [{ name: 'Emergency fund', targetMinor: 60_000_000, targetMonths: null, dueOn: '2027-09-30' }],
    });

    const sheet = await budgetSheetFor(database, ws, MONTH);

    expect(sheet.savings).toHaveLength(1);
    expect(sheet.savings[0]!.name).toBe('Emergency fund');
    expect(sheet.savings[0]!.planMinor).toBeGreaterThan(0);
    expect(sheet.savings[0]!.actualMinor).toBe(0);
  });

  it('leaves both bottom lines standing on their own figures', async () => {
    const { database, ws } = await workspaceWithSpending();
    await saveExpectedIncome(database, ws, 25_000_000);
    await saveBudget(database, ws, { categoryAccountId: await categoryId(database, ws, 'Food & Drink'), amountMinor: 300_000 });

    const sheet = await budgetSheetFor(database, ws, MONTH);

    expect(sheet.leftOverPlanMinor).toBe(25_000_000 - 300_000 - sheet.debtPaymentsPlanMinor - sheet.savingsPlanMinor);
    expect(sheet.leftOverActualMinor).toBe(20_000_000 - 500_000 - sheet.debtPaymentsActualMinor - sheet.savingsActualMinor);
  });
});
