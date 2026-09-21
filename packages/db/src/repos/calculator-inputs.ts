import { and, eq } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { calculatorInputs } from '../schema-health';
import { healthTablesExist } from './health-tables';

/**
 * The Calculators page's life-cover figures, as typed. A prefilled box never typed in is `undefined`, and is not
 * stored, so it keeps following the balance sheet and the education goals.
 */
export interface LifeCoverSaved {
  annualNeed: string;
  years: string;
  inflation: string;
  returnPercent: string;
  finalExpenses: string;
  inForce: string;
  debts: string | undefined;
  education: string | undefined;
  liquidAssets: string | undefined;
}

export class CalculatorInputsError extends Error {
  constructor(
    public readonly code: 'NO_TABLES',
    message: string,
  ) {
    super(message);
    this.name = 'CalculatorInputsError';
  }
}

const LIFE_COVER = 'life_cover';
const TYPED = ['annualNeed', 'years', 'inflation', 'returnPercent', 'finalExpenses', 'inForce'] as const;
const PREFILLED = ['debts', 'education', 'liquidAssets'] as const;

/**
 * Keeps what was typed into life cover, one row per workspace in `calculator_inputs` (0053) — its own table, so no goal
 * reader has anything to skip. One statement: the row is replaced whole.
 */
export async function saveLifeCoverDraft(database: Database, ws: WorkspaceContext, draft: LifeCoverSaved): Promise<void> {
  if (!(await healthTablesExist(database.db))) {
    throw new CalculatorInputsError('NO_TABLES', 'This database is too old to keep these figures; reopen the app to update it');
  }
  const kept: Record<string, string> = {};
  for (const key of [...TYPED, ...PREFILLED]) {
    const value = draft[key];
    if (typeof value === 'string') kept[key] = value;
  }
  const row = { workspaceId: ws.workspaceId, kind: LIFE_COVER, inputsJson: JSON.stringify({ version: 1, draft: kept }), updatedAt: new Date().toISOString() };
  await database.db
    .insert(calculatorInputs)
    .values(row)
    .onConflictDoUpdate({ target: [calculatorInputs.workspaceId, calculatorInputs.kind], set: { inputsJson: row.inputsJson, updatedAt: row.updatedAt } });
}

/** The figures kept last, or null when none were (or the database predates 0053). A box it cannot read is not typed. */
export async function getLifeCoverDraft(database: Database, ws: WorkspaceContext): Promise<LifeCoverSaved | null> {
  if (!(await healthTablesExist(database.db))) return null;
  const [row] = await database.db
    .select()
    .from(calculatorInputs)
    .where(and(eq(calculatorInputs.workspaceId, ws.workspaceId), eq(calculatorInputs.kind, LIFE_COVER)));
  if (!row) return null;
  let draft: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.inputsJson) as { draft?: unknown };
    if (parsed && typeof parsed.draft === 'object' && parsed.draft !== null) draft = parsed.draft as Record<string, unknown>;
  } catch {
    draft = {};
  }
  const text = (key: string) => (typeof draft[key] === 'string' ? (draft[key] as string) : undefined);
  return {
    annualNeed: text('annualNeed') ?? '',
    years: text('years') ?? '',
    inflation: text('inflation') ?? '',
    returnPercent: text('returnPercent') ?? '',
    finalExpenses: text('finalExpenses') ?? '',
    inForce: text('inForce') ?? '',
    debts: text('debts'),
    education: text('education'),
    liquidAssets: text('liquidAssets'),
  };
}
