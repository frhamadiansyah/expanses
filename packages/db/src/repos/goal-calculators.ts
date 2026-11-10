import {
  addMonths,
  assumedReturnBps,
  DEFAULT_EMERGENCY_BASE,
  emergencyOutgoingMinor,
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
  monthOf,
  monthsUntil,
  RETIREMENT_RETURN_BPS,
  type RetirementInputs,
  retirementTodayMinor,
  roundHalfAwayFromZero,
} from '@expanses/core';
import { and, asc, eq, sql } from 'drizzle-orm';
import { ownerScope, type WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { goalCalculators } from '../schema-budget';
import { goalStages, goals as goalsTable } from '../schema-goals';
import { goalStageTerms } from '../schema-health';
import { markGoalDirtyTx, withCapture } from '../sync/capture';
import { goalLinkOfTx } from '../sync/goals/scope';
import { periodFlows } from './flows';
import { goalSharingTablesExist } from './goal-sharing-tables';
import { drawnStageIds, GoalDbError, goalColumns, type GoalRow, listGoals, type SaveGoalStageInput, saveGoalTx } from './goals';
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
  /**
   * A fixed monthly outgoing, in the base currency, typed on the calculator. When set the months multiply it instead of
   * the spending read from the records; absent, the goal follows spending as it always did.
   */
  monthlyOutgoingMinor?: number;
  /** The months the fund is to be saved over: the goal falls due that far from the day it was worked out (two years when absent). */
  horizonMonths?: number;
  /** What the money earns a year while it waits, written as the goal's return when set. */
  returnBps?: number;
  /**
   * An amount the owner set by themself, rounding up from what the months work out to. When set it is the stage's whole
   * target (the months and the rest stay as the working); absent, the target is the months times the outgoing.
   */
  targetMinor?: number;
  /**
   * A shared fund's monthly outgoing, frozen in the working (shared goals D8): the base currency, from the last twelve
   * months of whoever shared or last recalculated, or the typed figure. Every phone's target reads it, so all show one.
   */
  sharedOutgoingMinor?: number;
  /** The day `sharedOutgoingMinor` was read. */
  sharedOutgoingOn?: string;
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

/**
 * What a calculator's inputs imply, in today's money — the goal engine inflates once, at the growth given here.
 * `today` dates the working; `returnsOn` is the day a level's band is read from (months left from today, Q8), which
 * for a v1 working upgraded on open is today, not the day it was first worked out.
 */
function derive(kind: CalculatorKind, raw: CalculatorInputs, today: string, goalName: string, returnsOn = today): Derived {
  if (kind === 'emergency') {
    const inputs = raw as EmergencyInputs;
    const { months, household, income, base } = inputs;
    if (!Number.isFinite(months) || months <= 0) throw new GoalDbError('An emergency fund needs a number of months above zero');
    if (household !== undefined && !HOUSEHOLDS.includes(household)) throw new GoalDbError('That household is not one this app knows');
    if (income !== undefined && !INCOME_STABILITIES.includes(income)) throw new GoalDbError('Income is salaried or irregular');
    if (base !== undefined && !EMERGENCY_BASES.includes(base)) throw new GoalDbError('An emergency fund counts essential or all spending');
    const { monthlyOutgoingMinor, horizonMonths, returnBps, targetMinor: ownTargetMinor } = inputs;
    if (ownTargetMinor !== undefined && (!Number.isSafeInteger(ownTargetMinor) || ownTargetMinor <= 0)) throw new GoalDbError('The target amount needs an amount above zero');
    if (monthlyOutgoingMinor !== undefined && (!Number.isSafeInteger(monthlyOutgoingMinor) || monthlyOutgoingMinor <= 0)) {
      throw new GoalDbError('What goes out a month needs an amount above zero');
    }
    if (horizonMonths !== undefined && (!Number.isSafeInteger(horizonMonths) || horizonMonths < 1)) throw new GoalDbError('Save it over a whole number of months, one or more');
    if (returnBps !== undefined && (!Number.isSafeInteger(returnBps) || returnBps < 0)) throw new GoalDbError('The return cannot be negative');
    // Months, not an amount: what it costs is worked out when it is read — from spending, or from the fixed monthly
    // figure when the working has one — so no growth.
    return {
      inputs: { ...inputs, version: 2 },
      stages: [
        {
          name: goalName,
          // An own target is a stage amount; the months stay in the working only (a stage has an amount or months, not both).
          targetMinor: ownTargetMinor ?? null,
          targetMonths: ownTargetMinor === undefined ? Math.round(months) : null,
          dueOn: horizonMonths === undefined ? yearsFrom(today, 2) : monthsFrom(today, horizonMonths),
          key: 'emergency',
          returnBps: null,
        },
      ],
      growthBps: 0,
      returnBps: returnBps ?? null,
      computedMinor: ownTargetMinor ?? 0,
    };
  }

  if (kind === 'education') {
    const inputs = isV1Education(raw) ? educationFromV1(raw, today) : (raw as EducationPlanInputs);
    const stages = educationPlanStages(inputs, returnsOn);
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

function monthsFrom(today: string, months: number): string {
  const [year, month, day] = today.split('-').map(Number);
  const first = new Date(Date.UTC(year!, month! - 1 + months, 1));
  // The same day of the month, or the last day of a shorter one.
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(day!, last))).toISOString().slice(0, 10);
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
    const [goal] = await tx.select(await goalColumns(tx)).from(goalsTable).where(and(eq(goalsTable.id, input.goalId), eq(goalsTable.workspaceId, ws.workspaceId)));
    if (!goal) throw new GoalDbError('Goal not found in this workspace');
    // A goal's return is its owner's (spec §8): a retirement working that names no return while saving keeps it.
    const inputs =
      input.kind === 'retirement' && (input.inputs as RetirementInputs).returnBeforeBps === undefined
        ? { ...(input.inputs as RetirementInputs), returnBeforeBps: goal.returnBps }
        : input.kind === 'education' && isV1Education(input.inputs)
          ? educationFromV1(input.inputs, input.today, goal.returnBps)
          : input.inputs;
    const shared = await isSharedOnTx(tx, goal.id);
    // A frozen figure belongs to a share: a goal that is not shared (any more) carries none.
    const derived = derive(input.kind, shared ? inputs : unfrozen(inputs), input.today, goal.name);
    await whenSharedCapturedTx(tx, goal.id, shared, async () => {
      await writeCalculatorTx(tx, ws, goal, input.kind, derived);
      // Whoever recalculates a shared fund freezes their own outgoing (D8).
      if (shared && input.kind === 'emergency') await freezeEmergencyOutgoingTx(tx, ws, goal.id, input.today);
    });
    return derived.computedMinor;
  });
}

const unfrozen = (inputs: CalculatorInputs): CalculatorInputs => {
  const { sharedOutgoingMinor: _minor, sharedOutgoingOn: _on, ...rest } = inputs as EmergencyInputs;
  return rest as CalculatorInputs;
};

/** Whether the goal's link is on here, so its working is a row of the household book. */
async function isSharedOnTx(tx: Db, goalId: string): Promise<boolean> {
  return (await goalSharingTablesExist(tx)) && (await goalLinkOfTx(tx, goalId))?.state === 'on';
}

/**
 * Runs a write of a goal's working under capture when the goal is shared: the goal, its stages, their terms and the
 * working are the targets, and the goal's summary is sent with the rest. Stages are named by entity as a re-work may
 * add or drop some.
 */
async function whenSharedCapturedTx(tx: Db, goalId: string, shared: boolean, write: () => Promise<void>): Promise<void> {
  if (!shared) return write();
  markGoalDirtyTx(tx, goalId);
  await withCapture(tx, [{ entity: 'goal', id: goalId }, { entity: 'goal_stage' }, { entity: 'goal_stage_term' }, { entity: 'goal_calculator', id: goalId }], write);
}

/**
 * Freezes this phone's monthly outgoing into a shared emergency fund's working (D8): the typed figure when the working
 * has one, otherwise the last twelve months here as the plan reads them. The caller writes under capture. A phone with
 * no spending to read freezes nothing, so a figure another member froze is not replaced by nothing. Returns the figure.
 */
export async function freezeEmergencyOutgoingTx(tx: Db, ws: WorkspaceContext, goalId: string, date: string): Promise<number> {
  const [row] = await tx
    .select()
    .from(goalCalculators)
    .where(and(eq(goalCalculators.goalId, goalId), eq(goalCalculators.workspaceId, ws.workspaceId)));
  if (!row || row.kind !== 'emergency') throw new GoalDbError('This goal has no emergency fund working');
  const inputs = JSON.parse(row.inputsJson) as EmergencyInputs;
  let outgoing = inputs.monthlyOutgoingMinor;
  if (outgoing === undefined) {
    const flows = await periodFlows({ db: tx } as unknown as Database, ownerScope(ws), { from: `${addMonths(monthOf(date), -11)}-01`, to: date });
    outgoing = flows.months > 0 ? Math.max(0, roundHalfAwayFromZero(emergencyOutgoingMinor(flows, inputs.base ?? DEFAULT_EMERGENCY_BASE) / flows.months)) : 0;
  }
  if (outgoing === 0) return 0;
  const frozen: EmergencyInputs = { ...inputs, sharedOutgoingMinor: outgoing, sharedOutgoingOn: date };
  await tx
    .update(goalCalculators)
    .set({ inputsJson: JSON.stringify(frozen) })
    .where(and(eq(goalCalculators.goalId, goalId), eq(goalCalculators.workspaceId, ws.workspaceId)));
  return outgoing;
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
  const derived = derive(input.kind, unfrozen(input.inputs), input.today, name);
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
    const [goal] = await tx.select(await goalColumns(tx)).from(goalsTable).where(eq(goalsTable.id, goalId));
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

/**
 * Writes an emergency working's own target (and, when given, its months) without re-working the goal: Edit goal saves
 * the stage itself, dates and all, and this keeps the working in step so the goal stays linked. `targetMinor`
 * undefined clears the own target. A goal with no emergency working is left alone.
 */
export async function setEmergencyOwnTarget(
  database: Database,
  ws: WorkspaceContext,
  goalId: string,
  change: { targetMinor?: number; months?: number },
): Promise<void> {
  const { targetMinor, months } = change;
  if (targetMinor !== undefined && (!Number.isSafeInteger(targetMinor) || targetMinor <= 0)) throw new GoalDbError('The target amount needs an amount above zero');
  if (months !== undefined && (!Number.isFinite(months) || months <= 0)) throw new GoalDbError('An emergency fund needs a number of months above zero');
  const row = await getGoalCalculator(database, ws, goalId);
  if (!row || row.kind !== 'emergency') return;
  const { targetMinor: _was, ...rest } = row.inputs as EmergencyInputs;
  const inputs: EmergencyInputs = { ...rest, version: 2, ...(months === undefined ? {} : { months }), ...(targetMinor === undefined ? {} : { targetMinor }) };
  await database.db
    .update(goalCalculators)
    .set({ inputsJson: JSON.stringify(inputs), computedMinor: targetMinor ?? 0 })
    .where(and(eq(goalCalculators.goalId, goalId), eq(goalCalculators.workspaceId, ws.workspaceId)));
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
 * Same growth, stages and stage returns. Stages are compared as a set of figures, never by position: the goal
 * lists them by date and sort, the working by level, and two levels can start on the same day. A stage the working no
 * longer asks for but that is kept anyway — paid, or drawn against — is no difference: a re-work would keep it too.
 * Without 0053 a stage has nowhere to keep a return, so returns are not compared.
 */
function sameFigures(goal: GoalRow, derived: Derived, drawn: Set<string>, withReturns: boolean): boolean {
  if (goal.growthBps !== derived.growthBps) return false;
  // The goal's own return is not compared: the upgrade gives a retirement working the goal's return as its return
  // while saving, and the other kinds name none, so the two can never differ here.
  const left = goal.stages.map((stage) => ({ figure: stageFigure(stage, withReturns), kept: stage.paidOn !== null || drawn.has(stage.id) }));
  for (const stage of derived.stages) {
    const at = left.findIndex((candidate) => candidate.figure === stageFigure(stage, withReturns));
    if (at < 0) return false;
    left.splice(at, 1);
  }
  return left.every((stage) => stage.kept);
}

const shiftDay = (day: string, days: number) => {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, date! + days)).toISOString().slice(0, 10);
};

/**
 * The day a v1 working was done, on the same basis as its stages. v1 stamped computed_at in UTC but dated the stages
 * from the local day — in WIB, the next day for anything saved between 00:00 and 06:59, and the next year on
 * 1 January. So the stages decide: of computed_at's UTC day and the day either side (every time zone is within one),
 * the one from which v1 would have dated the goal's first stage. Stages that match none leave the UTC day.
 */
function v1WorkedOn(row: GoalCalculatorRow, goal: GoalRow): string {
  const utcDay = row.computedAt.slice(0, 10);
  const first = goal.stages[0]?.dueOn; // listGoals gives them in date order
  const years =
    row.kind === 'emergency' ? 2 : row.kind === 'retirement' ? (row.inputs as RetirementInputs).yearsToRetirement : (row.inputs as EducationInputs).startsInYears;
  // A working with no sensible years is refused by derive() and left alone; it needs no day.
  if (typeof years !== 'number' || !Number.isFinite(years) || Math.abs(years) > 1000) return utcDay;
  const v1Due = (day: string): string => {
    if (row.kind !== 'education') return yearsFrom(day, years);
    // v1 education put its first year a whole number of years on, truncated by Date.UTC.
    const [year, month, date] = day.split('-').map(Number);
    return new Date(Date.UTC(year! + Math.trunc(years), month! - 1, date!)).toISOString().slice(0, 10);
  };
  return [0, 1, -1].map((days) => shiftDay(utcDay, days)).find((day) => v1Due(day) === first) ?? utcDay;
}

/** A goal shared on and not by this phone's member: its working is the sharer's to re-work. */
async function skipsSharedGoal(database: Database, goalId: string): Promise<boolean> {
  if (!(await goalSharingTablesExist(database.db))) return false;
  const link = await goalLinkOfTx(database.db, goalId);
  if (link?.state !== 'on') return false;
  const [me] = await database.db.values<[string]>(sql`SELECT member_id FROM shared_books WHERE book_id = ${link.bookId}`);
  return me?.[0] !== link.sharedBy;
}

/**
 * Works every goal worked out before today's-money stages out again, silently, and only when the figure changes: a v1
 * working is dated from the day it was worked out (`v1WorkedOn`), so that day stays the day it was worked out. And (Part 2
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
    // A shared goal is re-worked only by the member who shared it (C25), so two phones never rewrite one working.
    if (await skipsSharedGoal(database, goal.id)) continue;
    const workedOn = isV2(row) ? today : v1WorkedOn(row, goal);
    // A working from before kept the goal's own return (spec §8): retirement's stays the return while saving, and a
    // one-course education's becomes the course's typed return, so no band ever replaces it.
    const inputs =
      row.kind === 'retirement'
        ? { ...(row.inputs as RetirementInputs), returnBeforeBps: goal.returnBps }
        : row.kind === 'education' && isV1Education(row.inputs)
          ? educationFromV1(row.inputs, workedOn, goal.returnBps)
          : row.inputs;
    let derived: Derived;
    try {
      derived = derive(row.kind, inputs, workedOn, goal.name, today);
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
      const [goalRow] = await tx.select(await goalColumns(tx)).from(goalsTable).where(and(eq(goalsTable.id, goal.id), eq(goalsTable.workspaceId, ws.workspaceId)));
      // Keeps its computed_at: the working is re-stated, not redone on a new day.
      const shared = await isSharedOnTx(tx, goal.id);
      await whenSharedCapturedTx(tx, goal.id, shared, async () => {
        await writeCalculatorTx(tx, ws, goalRow!, row.kind, derived, row.computedAt);
        if (shared && row.kind === 'emergency') await freezeEmergencyOutgoingTx(tx, ws, goal.id, today);
      });
      return true;
    });
    if (didChange) changed.push(goal.id);
  }
  return changed;
}
