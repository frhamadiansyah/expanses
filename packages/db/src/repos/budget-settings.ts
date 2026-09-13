import { and, eq } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { budgetIncomeOverrides, budgetSettings } from '../schema-budget';
import { BudgetError } from './budgets';

export interface BudgetIncome {
  /** What an ordinary month is expected to bring in. */
  planMinor: number;
  /** What this month expects: the override when there is one, otherwise the plan. */
  amountMinor: number;
  overridden: boolean;
}

export interface SetIncomeOverrideInput {
  month: string;
  amountMinor: number;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function assertMonth(month: string): void {
  if (!MONTH.test(month)) throw new BudgetError(`"${month}" is not a month; write it as YYYY-MM`);
}

function assertAmount(amountMinor: number): void {
  if (!Number.isSafeInteger(amountMinor)) throw new BudgetError('An amount must be a whole number of minor units');
  if (amountMinor < 0) throw new BudgetError('Income cannot be less than nothing');
}

/** What the owner expects to take home. Actual income is read from the ledger, never from here. */
export async function saveExpectedIncome(database: Database, ws: WorkspaceContext, amountMinor: number): Promise<void> {
  assertAmount(amountMinor);
  const now = new Date().toISOString();
  await database.transaction(async (tx) => {
    const [existing] = await tx.select({ workspaceId: budgetSettings.workspaceId }).from(budgetSettings).where(eq(budgetSettings.workspaceId, ws.workspaceId));
    if (existing) {
      await tx.update(budgetSettings).set({ expectedIncomeMinor: amountMinor, updatedAt: now }).where(eq(budgetSettings.workspaceId, ws.workspaceId));
      return;
    }
    await tx.insert(budgetSettings).values({ workspaceId: ws.workspaceId, expectedIncomeMinor: amountMinor, updatedAt: now });
  });
}

/** A bonus month expects something different, for that month alone. */
export async function setIncomeOverride(database: Database, ws: WorkspaceContext, input: SetIncomeOverrideInput): Promise<void> {
  assertMonth(input.month);
  assertAmount(input.amountMinor);
  await database.transaction(async (tx) => {
    const [existing] = await tx
      .select({ month: budgetIncomeOverrides.month })
      .from(budgetIncomeOverrides)
      .where(and(eq(budgetIncomeOverrides.workspaceId, ws.workspaceId), eq(budgetIncomeOverrides.month, input.month)));
    if (existing) {
      await tx
        .update(budgetIncomeOverrides)
        .set({ amountMinor: input.amountMinor })
        .where(and(eq(budgetIncomeOverrides.workspaceId, ws.workspaceId), eq(budgetIncomeOverrides.month, input.month)));
      return;
    }
    await tx.insert(budgetIncomeOverrides).values({ workspaceId: ws.workspaceId, month: input.month, amountMinor: input.amountMinor });
  });
}

export async function clearIncomeOverride(database: Database, ws: WorkspaceContext, month: string): Promise<void> {
  assertMonth(month);
  await database.db
    .delete(budgetIncomeOverrides)
    .where(and(eq(budgetIncomeOverrides.workspaceId, ws.workspaceId), eq(budgetIncomeOverrides.month, month)));
}

export async function getBudgetIncome(database: Database, ws: WorkspaceContext, month: string): Promise<BudgetIncome> {
  assertMonth(month);
  const [settings] = await database.db
    .select({ expectedIncomeMinor: budgetSettings.expectedIncomeMinor })
    .from(budgetSettings)
    .where(eq(budgetSettings.workspaceId, ws.workspaceId));
  const [override] = await database.db
    .select({ amountMinor: budgetIncomeOverrides.amountMinor })
    .from(budgetIncomeOverrides)
    .where(and(eq(budgetIncomeOverrides.workspaceId, ws.workspaceId), eq(budgetIncomeOverrides.month, month)));

  const planMinor = settings?.expectedIncomeMinor ?? 0;
  return { planMinor, amountMinor: override?.amountMinor ?? planMinor, overridden: override !== undefined };
}
