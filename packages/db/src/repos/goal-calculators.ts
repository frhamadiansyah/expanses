import { type EducationInputs, educationStages, type RetirementInputs, retirementTargetMinor } from '@expanses/core';
import { and, eq } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { goalCalculators } from '../schema-budget';
import { GoalDbError, type SaveGoalStageInput, saveGoal } from './goals';
import { goals as goalsTable } from '../schema-goals';

/** An emergency fund counts months of outgoings, which are read from the flows when the sheet is built. */
export interface EmergencyInputs {
  months: number;
}

export type CalculatorKind = 'emergency' | 'education' | 'retirement';
export type CalculatorInputs = EmergencyInputs | EducationInputs | RetirementInputs;

export interface SaveGoalCalculatorInput {
  goalId: string;
  kind: CalculatorKind;
  inputs: CalculatorInputs;
  /** The day the working is done from, so education stages land on real dates. */
  today: string;
}

export interface GoalCalculatorRow {
  goalId: string;
  kind: CalculatorKind;
  inputs: CalculatorInputs;
  computedMinor: number;
  computedAt: string;
}

/** The stages a calculator's inputs imply, in the shape saveGoal wants. */
function stagesFor(input: SaveGoalCalculatorInput, goalName: string): { stages: SaveGoalStageInput[]; computedMinor: number } {
  if (input.kind === 'emergency') {
    const { months } = input.inputs as EmergencyInputs;
    if (!Number.isFinite(months) || months <= 0) throw new GoalDbError('An emergency fund needs a number of months above zero');
    // Months, not an amount: what it costs follows your spending, and is worked out when it is read.
    const dueOn = yearsFrom(input.today, 2);
    return { stages: [{ name: goalName, targetMinor: null, targetMonths: Math.round(months), dueOn }], computedMinor: 0 };
  }

  if (input.kind === 'education') {
    const stages = educationStages(input.inputs as EducationInputs, input.today);
    return {
      stages: stages.map((stage, index) => ({ name: `Year ${index + 1}`, targetMinor: stage.targetMinor, targetMonths: null, dueOn: stage.dueOn })),
      computedMinor: stages.reduce((total, stage) => total + stage.targetMinor, 0),
    };
  }

  const inputs = input.inputs as RetirementInputs;
  const targetMinor = retirementTargetMinor(inputs);
  return {
    stages: [{ name: 'Retirement fund', targetMinor, targetMonths: null, dueOn: yearsFrom(input.today, inputs.yearsToRetirement) }],
    computedMinor: targetMinor,
  };
}

function yearsFrom(today: string, years: number): string {
  const [year, month, day] = today.split('-').map(Number);
  return new Date(Date.UTC(year! + Math.max(0, Math.round(years)), month! - 1, day!)).toISOString().slice(0, 10);
}

/**
 * Works the target out and writes it onto the goal, keeping the inputs so it can be worked out again.
 * The goal's own name, growth and return are left as they are: the calculator owns the amount, not the goal.
 */
export async function saveGoalCalculator(database: Database, ws: WorkspaceContext, input: SaveGoalCalculatorInput): Promise<number> {
  const [goal] = await database.db
    .select()
    .from(goalsTable)
    .where(and(eq(goalsTable.id, input.goalId), eq(goalsTable.workspaceId, ws.workspaceId)));
  if (!goal) throw new GoalDbError('Goal not found in this workspace');

  const { stages, computedMinor } = stagesFor(input, goal.name);

  await saveGoal(database, ws, {
    id: goal.id,
    name: goal.name,
    kind: goal.kind,
    rank: goal.rank,
    growthBps: goal.growthBps,
    returnBps: goal.returnBps,
    standingMonthlyMinor: goal.standingMonthlyMinor,
    standingNote: goal.standingNote,
    stages,
    derived: true,
  });

  const now = new Date().toISOString();
  const row = {
    goalId: input.goalId,
    workspaceId: ws.workspaceId,
    kind: input.kind,
    inputsJson: JSON.stringify(input.inputs),
    computedMinor,
    computedAt: now,
  };
  const { goalId: _goalId, workspaceId: _workspaceId, ...changes } = row;
  await database.db.insert(goalCalculators).values(row).onConflictDoUpdate({ target: goalCalculators.goalId, set: changes });
  return computedMinor;
}

export interface CreateGoalFromCalculatorInput extends Omit<SaveGoalCalculatorInput, 'goalId'> {
  name: string;
  growthBps?: number;
  returnBps?: number;
}

/**
 * Starts a goal from a calculator's working, for someone who came to the answer before the goal.
 *
 * The figures are worked out before anything is written, so a refused input leaves no half-made goal
 * behind — the goal and its working arrive together or not at all.
 */
export async function createGoalFromCalculator(
  database: Database,
  ws: WorkspaceContext,
  input: CreateGoalFromCalculatorInput,
): Promise<string> {
  if (!input.name.trim()) throw new GoalDbError('Give this goal a name');
  // Throws before the goal exists when the figures make no sense.
  const { stages } = stagesFor({ ...input, goalId: 'unsaved' }, input.name.trim());

  const goalId = await saveGoal(database, ws, {
    name: input.name.trim(),
    kind: input.kind === 'emergency' ? 'emergency' : input.kind === 'education' ? 'education' : 'retirement',
    growthBps: input.growthBps ?? 400,
    returnBps: input.returnBps ?? 900,
    stages,
    derived: true,
  });

  await saveGoalCalculator(database, ws, { goalId, kind: input.kind, inputs: input.inputs, today: input.today });
  return goalId;
}

export async function getGoalCalculator(database: Database, ws: WorkspaceContext, goalId: string): Promise<GoalCalculatorRow | null> {
  const [row] = await database.db
    .select()
    .from(goalCalculators)
    .where(and(eq(goalCalculators.goalId, goalId), eq(goalCalculators.workspaceId, ws.workspaceId)));
  if (!row) return null;
  return {
    goalId: row.goalId,
    kind: row.kind,
    inputs: JSON.parse(row.inputsJson) as CalculatorInputs,
    computedMinor: row.computedMinor,
    computedAt: row.computedAt,
  };
}

/** Breaks the link on purpose. The stages stay exactly as they are; they are simply no longer derived. */
export async function clearGoalCalculator(database: Database, ws: WorkspaceContext, goalId: string): Promise<void> {
  await database.db
    .delete(goalCalculators)
    .where(and(eq(goalCalculators.goalId, goalId), eq(goalCalculators.workspaceId, ws.workspaceId)));
}

export async function listGoalCalculators(database: Database, ws: WorkspaceContext): Promise<GoalCalculatorRow[]> {
  const rows = await database.db.select().from(goalCalculators).where(eq(goalCalculators.workspaceId, ws.workspaceId));
  return rows.map((row) => ({
    goalId: row.goalId,
    kind: row.kind,
    inputs: JSON.parse(row.inputsJson) as CalculatorInputs,
    computedMinor: row.computedMinor,
    computedAt: row.computedAt,
  }));
}
