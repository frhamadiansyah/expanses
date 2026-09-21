import {
  assumedReturnBps,
  EMERGENCY_BASES,
  EMERGENCY_RETURN_BPS,
  type EducationInputs,
  educationFromV1,
  type EducationPlanInputs,
  educationPlanStages,
  type EmergencyBase,
  HOUSEHOLDS,
  type Household,
  INCOME_STABILITIES,
  type IncomeStability,
  monthsUntil,
  RETIREMENT_RETURN_BPS,
  type RetirementInputs,
  retirementTodayMinor,
} from '@expanses/core';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { goalCalculators } from '../schema-budget';
import { goalStages, goals as goalsTable } from '../schema-goals';
import { goalStageTerms } from '../schema-health';
import { GoalDbError, type GoalRow, listGoals, type SaveGoalStageInput, saveGoalTx } from './goals';
import { healthTablesExist } from './health-tables';

/**
 * An emergency fund counts months of outgoings, read from the flows when the sheet is built. The two answers are kept
 * so the screen can say which of them produced the months; `base` says what the months multiply.
 */
export interface EmergencyInputs {
  version?: 2;
  months: number;
  household?: Household;
  income?: IncomeStability;
  base?: EmergencyBase;
}

export type CalculatorKind = 'emergency' | 'education' | 'retirement';
/** A one-course education working (v1) is still accepted on the way in; it is always stored as levels (v2). */
export type CalculatorInputs = EmergencyInputs | EducationPlanInputs | EducationInputs | RetirementInputs;

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

interface DerivedStage extends SaveGoalStageInput {
  /** Which part of the working this stage is, so a re-work finds the same stage — and its paid mark — again. */
  key: string;
  returnBps: number | null;
}

interface Derived {
  inputs: CalculatorInputs;
  stages: DerivedStage[];
  growthBps: number;
  /** Written as the goal's return only when the working names one (retirement's return while saving). */
  returnBps: number | null;
  computedMinor: number;
}

const isV1Education = (inputs: CalculatorInputs): inputs is EducationInputs => 'feeTodayMinor' in inputs;

/** What a calculator's inputs imply, in today's money — the goal engine inflates once, at the growth given here. */
function derive(kind: CalculatorKind, raw: CalculatorInputs, today: string, goalName: string): Derived {
  if (kind === 'emergency') {
    const inputs = raw as EmergencyInputs;
    const { months, household, income, base } = inputs;
    if (!Number.isFinite(months) || months <= 0) throw new GoalDbError('An emergency fund needs a number of months above zero');
    if (household !== undefined && !HOUSEHOLDS.includes(household)) throw new GoalDbError('That household is not one this app knows');
    if (income !== undefined && !INCOME_STABILITIES.includes(income)) throw new GoalDbError('Income is salaried or irregular');
    if (base !== undefined && !EMERGENCY_BASES.includes(base)) throw new GoalDbError('An emergency fund counts essential or all spending');
    // Months, not an amount: what it costs follows your spending, and is worked out when it is read — so no growth.
    return {
      inputs: { ...inputs, version: 2 },
      stages: [{ name: goalName, targetMinor: null, targetMonths: Math.round(months), dueOn: yearsFrom(today, 2), key: 'emergency', returnBps: null }],
      growthBps: 0,
      returnBps: null,
      computedMinor: 0,
    };
  }

  if (kind === 'education') {
    const inputs = isV1Education(raw) ? educationFromV1(raw, today) : (raw as EducationPlanInputs);
    const stages = educationPlanStages(inputs, today);
    return {
      inputs,
      stages: stages.map((stage) => ({
        name: stage.name,
        targetMinor: stage.targetTodayMinor,
        targetMonths: null,
        dueOn: stage.dueOn,
        key: stage.key,
        returnBps: stage.returnBps,
      })),
      growthBps: inputs.feeInflationBps,
      returnBps: null,
      computedMinor: stages.reduce((total, stage) => total + stage.targetTodayMinor, 0),
    };
  }

  const inputs: RetirementInputs = { ...(raw as RetirementInputs), version: 2 };
  const targetMinor = retirementTodayMinor(inputs);
  return {
    inputs,
    stages: [{ name: 'Retirement fund', targetMinor, targetMonths: null, dueOn: yearsFrom(today, inputs.yearsToRetirement), key: 'retirement', returnBps: null }],
    growthBps: inputs.inflationBps,
    returnBps: inputs.returnBeforeBps ?? RETIREMENT_RETURN_BPS,
    computedMinor: targetMinor,
  };
}

function yearsFrom(today: string, years: number): string {
  const [year, month, day] = today.split('-').map(Number);
  return new Date(Date.UTC(year! + Math.max(0, Math.round(years)), month! - 1, day!)).toISOString().slice(0, 10);
}

/**
 * The stages of a goal that money was drawn against. The table is the set-aside work's (0050); on a database without
 * it nothing was ever drawn. Read with plain SQL so this file needs nothing from that schema.
 */
async function drawnStageIds(tx: Db, goalId: string): Promise<Set<string>> {
  const table = await tx.values<[number]>(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'goal_draws'`);
  if (table.length === 0) return new Set();
  const rows = await tx.values<[string]>(sql`SELECT DISTINCT stage_id FROM goal_draws WHERE goal_id = ${goalId} AND stage_id IS NOT NULL`);
  return new Set(rows.map((row) => row[0]));
}

type StageRow = typeof goalStages.$inferSelect;

/**
 * A goal with no keys — worked out before them, or on a database without 0053 — pairs its stages by what they say.
 * The same name on the same day first, then the same name (a level's year keeps its name when its dates move), and
 * only then, when the count is the same, by position: both sides in date order, since the goal lists its stages by
 * date and the working lists them by level. A paid year is never handed to another level's year, and a paid year
 * the working still asks for is found again rather than kept beside a new unpaid copy.
 */
function matchWithoutKeys(current: StageRow[], wanted: DerivedStage[]): (StageRow | undefined)[] {
  const matched: (StageRow | undefined)[] = wanted.map(() => undefined);
  const taken = new Set<string>();
  const pair = (same: (stage: StageRow, want: DerivedStage) => boolean) =>
    wanted.forEach((want, index) => {
      if (matched[index]) return;
      const found = current.find((stage) => !taken.has(stage.id) && same(stage, want));
      if (found) {
        matched[index] = found;
        taken.add(found.id);
      }
    });
  pair((stage, want) => stage.name === want.name && stage.dueOn === want.dueOn);
  pair((stage, want) => stage.name === want.name);
  if (current.length === wanted.length) {
    const left = current.filter((stage) => !taken.has(stage.id)); // already in date order
    const byDate = wanted
      .map((want, index) => ({ want, index }))
      .filter(({ index }) => !matched[index])
      .sort((a, b) => (a.want.dueOn < b.want.dueOn ? -1 : a.want.dueOn > b.want.dueOn ? 1 : a.index - b.index));
    byDate.forEach(({ index }, at) => (matched[index] = left[at]));
  }
  return matched;
}

/**
 * Writes the working onto the goal inside the caller's transaction: the goal's growth (and return, where the working
 * names one), its stages — keeping each stage that was already there, and its paid mark, by the key the working gave
 * it — the stages' own returns, and the inputs. A stage the working no longer asks for goes, unless it was paid or
 * money was drawn against it: that one stays as it is, and the working is laid around it. Name, rank, standing amount,
 * set-asides and tags are left alone.
 */
async function writeCalculatorTx(
  tx: Db,
  ws: WorkspaceContext,
  goal: typeof goalsTable.$inferSelect,
  kind: CalculatorKind,
  derived: Derived,
  computedAt = new Date().toISOString(),
): Promise<void> {
  const current = await tx
    .select()
    .from(goalStages)
    .where(and(eq(goalStages.goalId, goal.id), eq(goalStages.workspaceId, ws.workspaceId)))
    .orderBy(asc(goalStages.dueOn), asc(goalStages.sort));
  const withTerms = await healthTablesExist(tx);
  const terms = withTerms
    ? await tx
        .select()
        .from(goalStageTerms)
        .where(and(eq(goalStageTerms.goalId, goal.id), eq(goalStageTerms.workspaceId, ws.workspaceId)))
    : [];
  const stageOfKey = new Map(terms.filter((term) => term.derivedKey !== null).map((term) => [term.derivedKey!, term.stageId]));
  const byId = new Map(current.map((stage) => [stage.id, stage]));
  const matched =
    stageOfKey.size > 0 ? derived.stages.map((stage) => byId.get(stageOfKey.get(stage.key) ?? '')) : matchWithoutKeys(current, derived.stages);
  const matchedIds = new Set(matched.flatMap((stage) => (stage ? [stage.id] : [])));

  const drawn = await drawnStageIds(tx, goal.id);
  const kept = current.filter((stage) => !matchedIds.has(stage.id) && (stage.paidOn !== null || drawn.has(stage.id)));

  const { stageIds } = await saveGoalTx(tx, ws, {
    id: goal.id,
    name: goal.name,
    kind: goal.kind,
    rank: goal.rank,
    growthBps: derived.growthBps,
    returnBps: derived.returnBps ?? goal.returnBps,
    standingMonthlyMinor: goal.standingMonthlyMinor,
    standingNote: goal.standingNote,
    stages: [
      ...derived.stages.map((stage, index) => ({
        id: matched[index]?.id,
        name: stage.name,
        targetMinor: stage.targetMinor,
        targetMonths: stage.targetMonths,
        dueOn: stage.dueOn,
        paidOn: matched[index]?.paidOn ?? null,
      })),
      ...kept.map((stage) => ({ id: stage.id, name: stage.name, targetMinor: stage.targetMinor, targetMonths: stage.targetMonths, dueOn: stage.dueOn, paidOn: stage.paidOn })),
    ],
    derived: true,
  });

  if (withTerms) {
    await tx.delete(goalStageTerms).where(and(eq(goalStageTerms.goalId, goal.id), eq(goalStageTerms.workspaceId, ws.workspaceId)));
    for (const [index, stage] of derived.stages.entries()) {
      await tx
        .insert(goalStageTerms)
        .values({ stageId: stageIds[index]!, workspaceId: ws.workspaceId, goalId: goal.id, returnBps: stage.returnBps, derivedKey: stage.key });
    }
    // A kept stage keeps its own terms, key included, so the level coming back finds it again.
    const termOf = new Map(terms.map((term) => [term.stageId, term]));
    for (const stage of kept) {
      const term = termOf.get(stage.id);
      if (term) await tx.insert(goalStageTerms).values(term);
    }
  }

  const row = { goalId: goal.id, workspaceId: ws.workspaceId, kind, inputsJson: JSON.stringify(derived.inputs), computedMinor: derived.computedMinor, computedAt };
  const { goalId: _goalId, workspaceId: _workspaceId, ...changes } = row;
  await tx.insert(goalCalculators).values(row).onConflictDoUpdate({ target: goalCalculators.goalId, set: changes });
}

/**
 * Works the target out and writes it onto the goal in today's money, with the growth the working assumed, keeping the
 * inputs so it can be worked out again. One transaction: the goal, its stages, their returns and the working land
 * together or not at all.
 */
export async function saveGoalCalculator(database: Database, ws: WorkspaceContext, input: SaveGoalCalculatorInput): Promise<number> {
  return database.transaction(async (tx) => {
    const [goal] = await tx.select().from(goalsTable).where(and(eq(goalsTable.id, input.goalId), eq(goalsTable.workspaceId, ws.workspaceId)));
    if (!goal) throw new GoalDbError('Goal not found in this workspace');
    const derived = derive(input.kind, input.inputs, input.today, goal.name);
    await writeCalculatorTx(tx, ws, goal, input.kind, derived);
    return derived.computedMinor;
  });
}

export interface CreateGoalFromCalculatorInput extends Omit<SaveGoalCalculatorInput, 'goalId'> {
  name: string;
  returnBps?: number;
}

/**
 * Starts a goal from a calculator's working, for someone who came to the answer before the goal.
 *
 * The figures are worked out before anything is written, and everything is written in one transaction, so a refused
 * input leaves no half-made goal behind — the goal and its working arrive together or not at all.
 */
export async function createGoalFromCalculator(database: Database, ws: WorkspaceContext, input: CreateGoalFromCalculatorInput): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new GoalDbError('Give this goal a name');
  const derived = derive(input.kind, input.inputs, input.today, name);
  const firstDue = derived.stages.map((stage) => stage.dueOn).sort()[0]!;
  const returnBps =
    input.returnBps ?? derived.returnBps ?? (input.kind === 'emergency' ? EMERGENCY_RETURN_BPS : assumedReturnBps(monthsUntil(input.today, firstDue)));
  return database.transaction(async (tx) => {
    const { goalId } = await saveGoalTx(tx, ws, {
      name,
      kind: input.kind,
      growthBps: derived.growthBps,
      returnBps,
      stages: derived.stages.map(({ key: _key, returnBps: _returnBps, ...stage }) => stage),
      derived: true,
    });
    const [goal] = await tx.select().from(goalsTable).where(eq(goalsTable.id, goalId));
    await writeCalculatorTx(tx, ws, goal!, input.kind, derived);
    return goalId;
  });
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

const stageFigure = (stage: { targetMinor: number | null; targetMonths: number | null; dueOn: string; returnBps?: number | null }, withReturns: boolean) =>
  `${stage.dueOn}|${stage.targetMinor}|${stage.targetMonths}|${withReturns ? (stage.returnBps ?? null) : ''}`;

/**
 * Same growth, return, stages and stage returns. Stages are compared as a set of figures, never by position: the goal
 * lists them by date and sort, the working by level, and two levels can start on the same day. A stage the working no
 * longer asks for but that is kept anyway — paid, or drawn against — is no difference: a re-work would keep it too.
 * Without 0053 a stage has nowhere to keep a return, so returns are not compared.
 */
function sameFigures(goal: GoalRow, derived: Derived, drawn: Set<string>, withReturns: boolean): boolean {
  if (goal.growthBps !== derived.growthBps) return false;
  if (derived.returnBps !== null && goal.returnBps !== derived.returnBps) return false;
  const left = goal.stages.map((stage) => ({ figure: stageFigure(stage, withReturns), kept: stage.paidOn !== null || drawn.has(stage.id) }));
  for (const stage of derived.stages) {
    const at = left.findIndex((candidate) => candidate.figure === stageFigure(stage, withReturns));
    if (at < 0) return false;
    left.splice(at, 1);
  }
  return left.every((stage) => stage.kept);
}

/**
 * Works every goal worked out before today's-money stages out again, silently, and only when the figure changes: a v1
 * working is dated from its own computed_at, so the day it was worked out stays the day it was worked out. And (Part 2
 * Q1) a v2 education working is re-read from today, so a level whose return was never typed follows its band as its
 * start draws near; its dates are years or ages, so `today` moves only those returns. Retirement and emergency v2 are
 * left alone: their dates count from the day they were worked out. A goal typed by hand has no calculator row, so is
 * never visited. Each goal is written in its own transaction, keeping its computed_at. Returns the goals that changed.
 */
export async function upgradeCalculatorGoals(database: Database, ws: WorkspaceContext, today: string): Promise<string[]> {
  const isV2 = (row: GoalCalculatorRow) => (row.inputs as { version?: number }).version === 2;
  const rows = (await listGoalCalculators(database, ws)).filter((row) => !isV2(row) || row.kind === 'education');
  if (rows.length === 0) return [];
  const goals = await listGoals(database, ws, { includeArchived: true });
  const changed: string[] = [];
  for (const row of rows) {
    const goal = goals.find((candidate) => candidate.id === row.goalId);
    if (!goal) continue;
    const workedOn = isV2(row) ? today : row.computedAt.slice(0, 10);
    // A retirement worked out before kept the goal's own return; it stays the return while saving.
    const inputs = row.kind === 'retirement' ? { ...(row.inputs as RetirementInputs), returnBeforeBps: goal.returnBps } : row.inputs;
    let derived: Derived;
    try {
      derived = derive(row.kind, inputs, workedOn, goal.name);
    } catch {
      continue; // A working the rules now refuse is left exactly as it is, not half-rewritten.
    }
    const didChange = await database.transaction(async (tx) => {
      if (sameFigures(goal, derived, await drawnStageIds(tx, goal.id), await healthTablesExist(tx))) {
        // Nothing moves; the working is only stamped as read in today's money, so it is not visited again.
        if (!isV2(row)) {
          await tx
            .update(goalCalculators)
            .set({ inputsJson: JSON.stringify(derived.inputs) })
            .where(and(eq(goalCalculators.goalId, goal.id), eq(goalCalculators.workspaceId, ws.workspaceId)));
        }
        return false;
      }
      const [goalRow] = await tx.select().from(goalsTable).where(and(eq(goalsTable.id, goal.id), eq(goalsTable.workspaceId, ws.workspaceId)));
      // Keeps its computed_at: the working is re-stated, not redone on a new day.
      await writeCalculatorTx(tx, ws, goalRow!, row.kind, derived, row.computedAt);
      return true;
    });
    if (didChange) changed.push(goal.id);
  }
  return changed;
}
