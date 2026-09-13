import { type Goal, type GoalKind, type GoalStage, uuidv7 } from '@expanses/core';
import { recordContributionTx } from './goal-contributions';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts } from '../schema';
import { goalEarmarks, goalStages, goals } from '../schema-goals';

export class GoalDbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoalDbError';
  }
}

export interface GoalRow extends Goal {
  workspaceId: string;
  status: 'active' | 'achieved' | 'archived';
  createdAt: string;
}

export interface SaveGoalStageInput {
  id?: string;
  name: string;
  targetMinor: number | null;
  targetMonths: number | null;
  dueOn: string;
  paidOn?: string | null;
}

export interface SaveGoalInput {
  id?: string;
  name: string;
  kind: GoalKind;
  rank?: number;
  growthBps: number;
  returnBps: number;
  standingMonthlyMinor?: number;
  standingNote?: string | null;
  stages: SaveGoalStageInput[];
}

/** Only money you can move can be set aside; holdings are tagged per purchase instead. */
const EARMARKABLE = ['cash', 'bank', 'savings'];

export async function listGoals(database: Database, ws: WorkspaceContext, opts: { includeArchived?: boolean } = {}): Promise<GoalRow[]> {
  const rows = await database.db
    .select()
    .from(goals)
    .where(eq(goals.workspaceId, ws.workspaceId))
    .orderBy(asc(goals.rank), asc(goals.createdAt));
  const wanted = rows.filter((row) => opts.includeArchived || row.status !== 'archived');
  if (wanted.length === 0) return [];
  const stageRows = await database.db
    .select()
    .from(goalStages)
    .where(
      and(
        eq(goalStages.workspaceId, ws.workspaceId),
        inArray(
          goalStages.goalId,
          wanted.map((row) => row.id),
        ),
      ),
    )
    .orderBy(asc(goalStages.dueOn), asc(goalStages.sort));
  return wanted.map((row) => ({
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    kind: row.kind,
    rank: row.rank,
    growthBps: row.growthBps,
    returnBps: row.returnBps,
    standingMonthlyMinor: row.standingMonthlyMinor,
    standingNote: row.standingNote,
    status: row.status,
    createdAt: row.createdAt,
    stages: stageRows
      .filter((stage) => stage.goalId === row.id)
      .map(
        (stage): GoalStage => ({
          id: stage.id,
          name: stage.name,
          targetMinor: stage.targetMinor,
          targetMonths: stage.targetMonths,
          dueOn: stage.dueOn,
          paidOn: stage.paidOn,
        }),
      ),
  }));
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function checkStages(stages: SaveGoalStageInput[]): void {
  if (stages.length === 0) throw new GoalDbError('A goal needs at least one stage: what it costs and when you need it');
  for (const stage of stages) {
    if (!stage.name.trim()) throw new GoalDbError('Every stage needs a name');
    if (!DATE.test(stage.dueOn)) throw new GoalDbError(`Stage "${stage.name}" needs a date`);
    const hasAmount = stage.targetMinor !== null && stage.targetMinor !== undefined;
    const hasMonths = stage.targetMonths !== null && stage.targetMonths !== undefined;
    if (hasAmount === hasMonths) throw new GoalDbError(`Stage "${stage.name}" needs an amount or a number of months, not both`);
  }
}

/** Adds or updates a goal with its stages. Stage ids passed back are kept, so tags and paid marks survive. */
export async function saveGoal(database: Database, ws: WorkspaceContext, input: SaveGoalInput): Promise<string> {
  if (!input.name.trim()) throw new GoalDbError('Give this goal a name');
  if (input.growthBps < 0 || input.returnBps < 0) throw new GoalDbError('Growth and return cannot be negative');
  checkStages(input.stages);

  const id = input.id ?? uuidv7();
  return database.transaction(async (tx) => {
    const existing = await tx.select().from(goals).where(and(eq(goals.id, id), eq(goals.workspaceId, ws.workspaceId)));
    const rank = input.rank ?? existing[0]?.rank ?? (await nextRank(tx, ws));
    const row = {
      id,
      workspaceId: ws.workspaceId,
      name: input.name.trim(),
      kind: input.kind,
      rank,
      growthBps: input.growthBps,
      returnBps: input.returnBps,
      standingMonthlyMinor: input.standingMonthlyMinor ?? 0,
      standingNote: input.standingNote ?? null,
      status: existing[0]?.status ?? ('active' as const),
      createdAt: existing[0]?.createdAt ?? new Date().toISOString(),
    };
    const { id: _id, createdAt: _createdAt, ...changes } = row;
    await tx.insert(goals).values(row).onConflictDoUpdate({ target: goals.id, set: changes });

    const keptIds = input.stages.map((stage) => stage.id).filter((stageId): stageId is string => !!stageId);
    const current = await tx.select({ id: goalStages.id }).from(goalStages).where(eq(goalStages.goalId, id));
    for (const stage of current) {
      if (!keptIds.includes(stage.id)) await tx.delete(goalStages).where(eq(goalStages.id, stage.id));
    }
    for (const [index, stage] of input.stages.entries()) {
      const stageRow = {
        id: stage.id ?? uuidv7(),
        goalId: id,
        workspaceId: ws.workspaceId,
        name: stage.name.trim(),
        targetMinor: stage.targetMinor ?? null,
        targetMonths: stage.targetMonths ?? null,
        dueOn: stage.dueOn,
        sort: index,
        paidOn: stage.paidOn ?? null,
      };
      const { id: _stageId, goalId: _goalId, workspaceId: _workspaceId, ...stageChanges } = stageRow;
      await tx.insert(goalStages).values(stageRow).onConflictDoUpdate({ target: goalStages.id, set: stageChanges });
    }
    return id;
  });
}

async function nextRank(tx: Db, ws: WorkspaceContext): Promise<number> {
  const rows = await tx.select({ rank: goals.rank }).from(goals).where(eq(goals.workspaceId, ws.workspaceId));
  return rows.length === 0 ? 0 : Math.max(...rows.map((row) => row.rank)) + 1;
}

export async function archiveGoal(database: Database, ws: WorkspaceContext, goalId: string): Promise<void> {
  await database.db.update(goals).set({ status: 'archived' }).where(and(eq(goals.id, goalId), eq(goals.workspaceId, ws.workspaceId)));
}

/** Writes the order the owner dragged the goals into; the first is funded first. */
export async function reorderGoals(database: Database, ws: WorkspaceContext, goalIdsInOrder: string[]): Promise<void> {
  await database.transaction(async (tx) => {
    for (const [index, goalId] of goalIdsInOrder.entries()) {
      await tx.update(goals).set({ rank: index }).where(and(eq(goals.id, goalId), eq(goals.workspaceId, ws.workspaceId)));
    }
  });
}

export async function setStagePaid(database: Database, ws: WorkspaceContext, stageId: string, paidOn: string | null): Promise<void> {
  if (paidOn !== null && !DATE.test(paidOn)) throw new GoalDbError('A paid date is YYYY-MM-DD');
  await database.db.update(goalStages).set({ paidOn }).where(and(eq(goalStages.id, stageId), eq(goalStages.workspaceId, ws.workspaceId)));
}

export interface EarmarkRow {
  goalId: string;
  accountId: string;
  amountMinor: number;
}

export async function listEarmarks(database: Database, ws: WorkspaceContext): Promise<EarmarkRow[]> {
  const rows = await database.db
    .select({ goalId: goalEarmarks.goalId, accountId: goalEarmarks.accountId, amountMinor: goalEarmarks.amountMinor })
    .from(goalEarmarks)
    .where(eq(goalEarmarks.workspaceId, ws.workspaceId));
  return rows;
}

/** Sets money aside from a savings account for a goal, replacing any earlier amount. */
export async function saveEarmark(database: Database, ws: WorkspaceContext, input: EarmarkRow): Promise<void> {
  if (!(input.amountMinor > 0)) throw new GoalDbError('Set aside an amount greater than zero');
  await database.transaction(async (tx) => {
    const [account] = await tx
      .select({ subtype: accounts.subtype })
      .from(accounts)
      .where(and(eq(accounts.id, input.accountId), eq(accounts.workspaceId, ws.workspaceId)));
    if (!account) throw new GoalDbError('Account not found in this workspace');
    if (!EARMARKABLE.includes(account.subtype)) {
      throw new GoalDbError('Only cash, bank and savings accounts can be set aside; a holding is tagged on each purchase instead');
    }
    const [goal] = await tx.select({ id: goals.id }).from(goals).where(and(eq(goals.id, input.goalId), eq(goals.workspaceId, ws.workspaceId)));
    if (!goal) throw new GoalDbError('Goal not found in this workspace');
    const [before] = await tx
      .select({ amountMinor: goalEarmarks.amountMinor })
      .from(goalEarmarks)
      .where(and(eq(goalEarmarks.goalId, input.goalId), eq(goalEarmarks.accountId, input.accountId), eq(goalEarmarks.workspaceId, ws.workspaceId)));
    const row = { goalId: input.goalId, accountId: input.accountId, workspaceId: ws.workspaceId, amountMinor: input.amountMinor };
    await tx
      .insert(goalEarmarks)
      .values(row)
      .onConflictDoUpdate({ target: [goalEarmarks.goalId, goalEarmarks.accountId], set: { amountMinor: input.amountMinor } });
    // Only the difference is a contribution: re-saving the same amount moved nothing.
    await recordContributionTx(tx, ws, input.goalId, input.accountId, input.amountMinor - (before?.amountMinor ?? 0));
  });
}

export async function removeEarmark(database: Database, ws: WorkspaceContext, goalId: string, accountId: string): Promise<void> {
  // The balance and its record of the movement have to fall together, so this runs as one.
  await database.transaction(async (tx) => {
    const [before] = await tx
      .select({ amountMinor: goalEarmarks.amountMinor })
      .from(goalEarmarks)
      .where(and(eq(goalEarmarks.goalId, goalId), eq(goalEarmarks.accountId, accountId), eq(goalEarmarks.workspaceId, ws.workspaceId)));
    if (!before) return;
    await tx
      .delete(goalEarmarks)
      .where(and(eq(goalEarmarks.goalId, goalId), eq(goalEarmarks.accountId, accountId), eq(goalEarmarks.workspaceId, ws.workspaceId)));
    await recordContributionTx(tx, ws, goalId, accountId, -before.amountMinor);
  });
}
