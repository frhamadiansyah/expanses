import { DEFAULT_SPENDING_GUIDE, type EssentialSplit, essentialSplit, isValidGuide, readGuide, type SpendingGuide } from '@expanses/core';
import { and, eq } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { calculatorInputs } from '../schema-health';
import type { Unconverted } from './book-currency';
import { resolvedCategoryNeeds } from './category-needs';
import { healthTablesExist } from './health-tables';
import { categoryTotalsIn } from './reports';

export interface EssentialSplitResult {
  split: EssentialSplit;
  currency: string;
  missing: Unconverted[];
}

/**
 * Essential · Lifestyle · Debts & savings over a period, read through exactly what Cashflow's two rings read: the
 * category totals on each side, bills in the month they came out, events held out unless the workspace counts them,
 * and the Paid with filter when one is on. No second definition of income or spending is made here.
 */
export async function essentialSplitIn(
  database: Database,
  ws: WorkspaceContext,
  from: string,
  to: string,
  opts: { excludeEvents: boolean; paidAccountId?: string },
): Promise<EssentialSplitResult> {
  const read = { excludeEvents: opts.excludeEvents, billMonths: true, paidAccountId: opts.paidAccountId };
  const [income, spending, needs] = await Promise.all([
    categoryTotalsIn(database, ws, 'income', from, to, read),
    categoryTotalsIn(database, ws, 'expense', from, to, read),
    resolvedCategoryNeeds(database.db, ws),
  ]);
  const missing = new Map<string, string>();
  for (const row of [...income.missing, ...spending.missing]) {
    const held = missing.get(row.currency);
    if (!held || row.onDate < held) missing.set(row.currency, row.onDate);
  }
  return {
    split: essentialSplit({ incomeMinor: income.rows.reduce((sum, row) => sum + row.amountBaseMinor, 0), spending: spending.rows, needs }),
    currency: spending.currency,
    missing: [...missing].map(([currency, onDate]) => ({ currency, onDate })),
  };
}

/*
 * The guide is kept the way the debt plan's settings are: one row in `calculator_inputs` (0053), which already has a
 * row per workspace and kind. Each workspace the owner opens keeps its own, so the kind names the open one. A way of
 * reading the money, not a fact about it, so it stays on this device as the debt plan does.
 */
const GUIDE = 'spending_guide';
const guideKind = (ws: WorkspaceContext) => (ws.bookId ? `${GUIDE}:${ws.bookId}` : GUIDE);

export class SpendingGuideError extends Error {
  constructor(
    public readonly code: 'NO_TABLES' | 'INVALID',
    message: string,
  ) {
    super(message);
    this.name = 'SpendingGuideError';
  }
}

/** The open workspace's guide, or 50 / 30 / 20 when none was saved, the row cannot be read, or the database predates 0053. */
export async function getSpendingGuide(database: Database, ws: WorkspaceContext): Promise<SpendingGuide> {
  if (!(await healthTablesExist(database.db))) return DEFAULT_SPENDING_GUIDE;
  const [row] = await database.db
    .select()
    .from(calculatorInputs)
    .where(and(eq(calculatorInputs.workspaceId, ws.workspaceId), eq(calculatorInputs.kind, guideKind(ws))));
  if (!row) return DEFAULT_SPENDING_GUIDE;
  try {
    return readGuide(JSON.parse(row.inputsJson));
  } catch {
    return DEFAULT_SPENDING_GUIDE;
  }
}

/** Keeps the open workspace's guide. Three whole percents that add up to 100, or nothing is written. */
export async function saveSpendingGuide(database: Database, ws: WorkspaceContext, guide: SpendingGuide): Promise<void> {
  if (!(await healthTablesExist(database.db))) {
    throw new SpendingGuideError('NO_TABLES', 'This database is too old to keep a guide; reopen the app to update it');
  }
  if (!isValidGuide(guide)) throw new SpendingGuideError('INVALID', 'Essential, Lifestyle and Debts & savings must add up to 100%');
  const kept = { version: 1, essential: guide.essential, lifestyle: guide.lifestyle, debtsSavings: guide.debtsSavings };
  const row = { workspaceId: ws.workspaceId, kind: guideKind(ws), inputsJson: JSON.stringify(kept), updatedAt: new Date().toISOString() };
  await database.db
    .insert(calculatorInputs)
    .values(row)
    .onConflictDoUpdate({ target: [calculatorInputs.workspaceId, calculatorInputs.kind], set: { inputsJson: row.inputsJson, updatedAt: row.updatedAt } });
}

/** Back to 50 / 30 / 20: the saved row goes, so a later change of the default reaches this workspace too. */
export async function resetSpendingGuide(database: Database, ws: WorkspaceContext): Promise<void> {
  if (!(await healthTablesExist(database.db))) return;
  await database.db.delete(calculatorInputs).where(and(eq(calculatorInputs.workspaceId, ws.workspaceId), eq(calculatorInputs.kind, guideKind(ws))));
}
