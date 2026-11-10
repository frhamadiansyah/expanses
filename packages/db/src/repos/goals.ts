import { currencyInfo, type Goal, type GoalKind, type GoalStage, uuidv7 } from '@expanses/core';
import { and, asc, eq, getTableColumns, inArray, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts } from '../schema';
import { goalCalculators } from '../schema-budget';
import { goalEarmarks, goals, goalsBefore0091, goalStages } from '../schema-goals';
import { goalStageTerms } from '../schema-health';
import { MONEY_SUBTYPES } from './accounts';
import { recordContributionTx } from './goal-contributions';
import { healthTablesExist } from './health-tables';
import { isPocketParentTx } from './set-aside-tx';
import { type CaptureTarget, markGoalDirtyTx, withCapture } from '../sync/capture';
import { goalLinkOfTx } from '../sync/goals/scope';
import { markGoalDeletedTx } from './goal-sharing';
import { goalSharingTablesExist } from './goal-sharing-tables';

const currencyColumn = new WeakMap<Db, boolean>();

/**
 * Whether migration 0091 has run on this database. A database stopped before it reads and writes goals without the
 * currency, every goal in the base currency, as before. A positive answer is remembered per handle; a negative one
 * is not, since migrate() may run later on the same handle.
 */
export async function goalCurrencyExists(db: Db): Promise<boolean> {
  if (currencyColumn.get(db)) return true;
  const rows = await db.values<[number]>(sql`SELECT 1 FROM pragma_table_info('goals') WHERE name = 'currency'`);
  const exists = rows.length > 0;
  if (exists) currencyColumn.set(db, true);
  return exists;
}

/** The goals table's columns, without `currency` on a database that has not reached 0091 (the row then reads it as absent). */
export async function goalColumns(db: Db): Promise<ReturnType<typeof getTableColumns<typeof goals>>> {
  const full = getTableColumns(goals);
  if (await goalCurrencyExists(db)) return full;
  const { currency: _currency, ...rest } = full;
  return rest as typeof full;
}

export class GoalDbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoalDbError';
  }
}

export interface GoalRow extends Goal {
  workspaceId: string;
  /** Always set on a row read back: the goal's own currency, the workspace's base where none was written. */
  currency: string;
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
  /** The goal's currency. Omitted keeps an existing goal's, and gives a new one the workspace's base. */
  currency?: string;
  stages: SaveGoalStageInput[];
  /** Set only by a calculator writing its own working. Anything else typed here breaks the link. */
  derived?: boolean;
}

export async function listGoals(database: Database, ws: WorkspaceContext, opts: { includeArchived?: boolean } = {}): Promise<GoalRow[]> {
  const rows = await database.db
    .select(await goalColumns(database.db))
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
  // A stage's own return, where a calculator gave it one; without 0053 no stage has one.
  const terms = (await healthTablesExist(database.db))
    ? await database.db
        .select({ stageId: goalStageTerms.stageId, returnBps: goalStageTerms.returnBps })
        .from(goalStageTerms)
        .where(eq(goalStageTerms.workspaceId, ws.workspaceId))
    : [];
  const returnOf = new Map(terms.map((row) => [row.stageId, row.returnBps]));
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
    currency: row.currency ?? ws.baseCurrency,
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
          returnBps: returnOf.get(stage.id) ?? null,
        }),
      ),
  }));
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function checkStages(stages: SaveGoalStageInput[]): void {
  if (stages.length === 0) throw new GoalDbError('A goal needs at least one stage: what it costs and when it is needed');
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
  checkGoal(input);
  return (await database.transaction((tx) => saveGoalTx(tx, ws, input))).goalId;
}

function checkGoal(input: SaveGoalInput): void {
  if (!input.name.trim()) throw new GoalDbError('Give this goal a name');
  if (input.growthBps < 0 || input.returnBps < 0) throw new GoalDbError('Growth and return cannot be negative');
  checkStages(input.stages);
}

/** The body of `saveGoal`, for a caller already inside a transaction. Stage ids come back in the order given. */
export async function saveGoalTx(tx: Db, ws: WorkspaceContext, input: SaveGoalInput): Promise<{ goalId: string; stageIds: string[] }> {
  checkGoal(input);
  const id = input.id ?? uuidv7();
  const existing = await tx.select(await goalColumns(tx)).from(goals).where(and(eq(goals.id, id), eq(goals.workspaceId, ws.workspaceId)));
  const rank = input.rank ?? existing[0]?.rank ?? (await nextRank(tx, ws));
  const before = existing[0] ? (existing[0].currency ?? ws.baseCurrency) : null;
  const currency = (input.currency ?? before ?? ws.baseCurrency).trim().toUpperCase();
  try {
    currencyInfo(currency);
  } catch {
    throw new GoalDbError('Pick a currency for this goal');
  }
  // Money already counted toward the goal is in the old currency: changing it would silently re-label that money.
  if (before !== null && before !== currency && (await goalHasFunding(tx, id))) {
    throw new GoalDbError('Money is already set aside or tagged for this goal, so its currency cannot change.');
  }
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
    currency,
    status: existing[0]?.status ?? ('active' as const),
    createdAt: existing[0]?.createdAt ?? new Date().toISOString(),
  };
  const { id: _id, createdAt: _createdAt, ...changes } = row;

  const keptIds = input.stages.map((stage) => stage.id).filter((stageId): stageId is string => !!stageId);
  const current = await tx.select({ id: goalStages.id, name: goalStages.name }).from(goalStages).where(eq(goalStages.goalId, id));
  // A draw names the stage it paid, so that stage never goes (the set-aside ruling): a hand edit that drops it is
  // refused, and a calculator's re-work keeps it (writeCalculatorTx passes it back). A partner's spend counts too (§9.4).
  const drawn = await drawnStageIds(tx, id);
  const dropped = current.find((stage) => !keptIds.includes(stage.id) && drawn.has(stage.id));
  if (dropped) throw new GoalDbError(`Money was drawn against "${dropped.name}", so it cannot be removed. Archive the goal instead.`);
  // Named before the write, so capture sees every row this save can touch: a shared goal's edit goes out (C10).
  const stageIds = input.stages.map((stage) => stage.id ?? uuidv7());
  const touched = [...new Set([...current.map((stage) => stage.id), ...stageIds])];
  const targets: CaptureTarget[] = [
    { entity: 'goal', id },
    ...touched.map((stageId) => ({ entity: 'goal_stage', id: stageId })),
    ...touched.map((stageId) => ({ entity: 'goal_stage_term', id: stageId })),
    { entity: 'goal_calculator', id },
  ];
  await withGoalCapture(tx, targets, async () => {
    if (await goalCurrencyExists(tx)) {
      await tx.insert(goals).values(row).onConflictDoUpdate({ target: goals.id, set: changes });
    } else {
      const { currency: _currency, ...older } = row;
      const { currency: _changed, ...olderChanges } = changes;
      await tx.insert(goalsBefore0091).values(older).onConflictDoUpdate({ target: goalsBefore0091.id, set: olderChanges });
    }

    for (const stage of current) {
      if (!keptIds.includes(stage.id)) await tx.delete(goalStages).where(eq(goalStages.id, stage.id));
    }
    for (const [index, stage] of input.stages.entries()) {
      const stageRow = {
        id: stageIds[index]!,
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

    if (await healthTablesExist(tx)) {
      // A stage that went away takes its terms with it; a hand-typed save drops them all, like the calculator link.
      const removed = current.map((stage) => stage.id).filter((stageId) => !keptIds.includes(stageId));
      for (const stageId of removed) await tx.delete(goalStageTerms).where(eq(goalStageTerms.stageId, stageId));
      if (!input.derived) {
        await tx.delete(goalStageTerms).where(and(eq(goalStageTerms.goalId, id), eq(goalStageTerms.workspaceId, ws.workspaceId)));
      }
    }

    // An amount typed by hand is the owner's, so the goal stops being derived from a calculator.
    // Only an existing goal can carry one, and saveGoal still has to work on a database that has
    // not reached migration 0017 — creating a goal must not reach for a table that is not there yet.
    if (!input.derived && existing.length > 0) {
      await tx.delete(goalCalculators).where(and(eq(goalCalculators.goalId, id), eq(goalCalculators.workspaceId, ws.workspaceId)));
    }
  });
  return { goalId: id, stageIds };
}

/**
 * Whether anything is counted toward the goal: money set aside, a buy tagged to it (whole or in part), a monthly buy
 * template, a draw or a recorded movement — this phone's, or, for a shared goal, any member's line with something in
 * it or History line (§9.1), so the currency stays locked once anyone funds it. Read with plain SQL so a database
 * without a table reads it as none.
 */
export async function goalHasFunding(tx: Db, goalId: string): Promise<boolean> {
  const tables = new Set((await tx.values<[string]>(sql`SELECT name FROM sqlite_master WHERE type = 'table'`)).map((row) => row[0]));
  const checks: [string, string][] = [
    ['goal_earmarks', 'goal_id'],
    ['investment_trades', 'goal_id'],
    ['trade_templates', 'goal_id'],
    ['goal_draws', 'goal_id'],
    ['trade_goal_parts', 'goal_id'],
    ['goal_contributions', 'goal_id'],
  ];
  for (const [table, column] of checks) {
    if (!tables.has(table)) continue;
    const found = await tx.values<[number]>(sql.raw(`SELECT 1 FROM ${table} WHERE ${column} = '${goalId.replace(/'/g, "''")}' LIMIT 1`));
    if (found.length > 0) return true;
  }
  if (tables.has('goal_member_funding')) {
    if ((await tx.values(sql`SELECT 1 FROM goal_member_funding WHERE goal_id = ${goalId} AND lines_json <> '[]' LIMIT 1`)).length > 0) return true;
    if ((await tx.values(sql`SELECT 1 FROM goal_member_moves WHERE goal_id = ${goalId} LIMIT 1`)).length > 0) return true;
  }
  return false;
}

/** `goalHasFunding` for a screen: whether the goal's currency can still be changed. */
export async function goalIsFunded(database: Database, goalId: string): Promise<boolean> {
  return database.transaction((tx) => goalHasFunding(tx, goalId));
}

/**
 * The stages of a goal that money was drawn against: this phone's draws, and for a shared goal any member's spend in
 * its History (§9.4). The tables are the set-aside work's (0050) and 0109; on a database without one nothing was
 * drawn there. Read with plain SQL so this file needs nothing from those schemas.
 */
export async function drawnStageIds(tx: Db, goalId: string): Promise<Set<string>> {
  const tables = new Set(
    (await tx.values<[string]>(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('goal_draws', 'goal_member_moves')`)).map((row) => row[0]),
  );
  const ids = new Set<string>();
  for (const table of ['goal_draws', 'goal_member_moves']) {
    if (!tables.has(table)) continue;
    const rows = await tx.values<[string]>(sql`SELECT DISTINCT stage_id FROM ${sql.raw(table)} WHERE goal_id = ${goalId} AND stage_id IS NOT NULL`);
    for (const [stageId] of rows) ids.add(stageId);
  }
  return ids;
}

/**
 * `withCapture` for writes of a goal's synced rows (§8.5): a shared goal's edit goes out, judged as a peer's would be.
 * A database before 0109 shares no goal, and its capture could not read the goal entities' scope.
 */
export async function withGoalCapture<T>(tx: Db, target: CaptureTarget | readonly CaptureTarget[], fn: () => Promise<T>): Promise<T> {
  return (await goalSharingTablesExist(tx)) ? withCapture(tx, target, fn) : fn();
}

/**
 * The sharer of a goal shared now, named, when this phone's member is someone else (C12, D10); null for a goal not
 * shared, or shared by this phone's member.
 */
async function otherSharerTx(tx: Db, goalId: string): Promise<string | null> {
  if (!(await goalSharingTablesExist(tx))) return null;
  const link = await goalLinkOfTx(tx, goalId);
  if (!link || link.state !== 'on') return null;
  const [me] = await tx.values<[string]>(sql`SELECT member_id FROM shared_books WHERE book_id = ${link.bookId}`);
  if (!me || me[0] === link.sharedBy) return null;
  const [name] = await tx.values<[string]>(sql`SELECT name FROM book_members WHERE book_id = ${link.bookId} AND member_id = ${link.sharedBy}`);
  return name?.[0] ?? 'Another member';
}

async function nextRank(tx: Db, ws: WorkspaceContext): Promise<number> {
  const rows = await tx.select({ rank: goals.rank }).from(goals).where(eq(goals.workspaceId, ws.workspaceId));
  return rows.length === 0 ? 0 : Math.max(...rows.map((row) => row.rank)) + 1;
}

/** Archives a goal. A shared one only its sharer archives (D10): it stops the goal claiming money on every phone. */
export async function archiveGoal(database: Database, ws: WorkspaceContext, goalId: string): Promise<void> {
  await database.transaction(async (tx) => {
    const sharer = await otherSharerTx(tx, goalId);
    if (sharer !== null) throw new GoalDbError(`Only ${sharer} can archive this shared goal`);
    await withGoalCapture(tx, { entity: 'goal', id: goalId }, () =>
      tx.update(goals).set({ status: 'archived' }).where(and(eq(goals.id, goalId), eq(goals.workspaceId, ws.workspaceId))),
    );
    markGoalDirtyTx(tx, goalId);
  });
}

/**
 * Deletes a goal and everything that only described it: what was set aside returns to its accounts, its purchases are
 * untagged (the purchases, sales and spending stay, as the records they are), and its payments, working, history and
 * contributions go. A goal other goals share a split purchase with leaves their parts as they were. A shared goal only
 * its sharer deletes (C12): the link goes to 'deleted' first, the one op sent, and every other phone keeps a copy.
 */
export async function deleteGoal(database: Database, ws: WorkspaceContext, goalId: string): Promise<void> {
  await database.transaction(async (tx) => {
    const [goal] = await tx.select({ id: goals.id }).from(goals).where(and(eq(goals.id, goalId), eq(goals.workspaceId, ws.workspaceId)));
    if (!goal) throw new GoalDbError('Goal not found in this workspace');
    const sharer = await otherSharerTx(tx, goalId);
    if (sharer !== null) throw new GoalDbError(`${sharer} shared this goal; leave it instead`);
    await markGoalDeletedTx(tx, goalId);
    await deleteGoalRowsTx(tx, ws, goalId);
  });
}

/**
 * The body of `deleteGoal`, and of a phone following a shared goal's delete (`sync/goals/follow.ts`): the goal and
 * everything of this phone's that names it, the goal last. Tags on trades, templates, sales, transfers and events are
 * cleared, never the records themselves; the members' lines and the share's History go too. Sends nothing: by now the
 * goal's rows are out of any book. Plain SQL, so a table an older database lacks reads as none.
 */
export async function deleteGoalRowsTx(tx: Db, ws: WorkspaceContext, goalId: string): Promise<void> {
  const tables = new Set((await tx.values<[string]>(sql`SELECT name FROM sqlite_master WHERE type = 'table'`)).map((row) => row[0]));
  const w = ws.workspaceId;
  for (const table of ['investment_trades', 'trade_templates', 'asset_sales', 'transactions', 'events']) {
    if (tables.has(table)) await tx.run(sql`UPDATE ${sql.raw(table)} SET goal_id = NULL WHERE goal_id = ${goalId} AND workspace_id = ${w}`);
  }
  for (const table of ['trade_goal_parts', 'goal_member_funding', 'goal_member_moves', 'goal_share_log']) {
    if (tables.has(table)) await tx.run(sql`DELETE FROM ${sql.raw(table)} WHERE goal_id = ${goalId}`);
  }
  for (const table of ['goal_draws', 'goal_contributions', 'goal_calculators', 'goal_stage_terms', 'goal_earmarks', 'goal_stages']) {
    if (tables.has(table)) await tx.run(sql`DELETE FROM ${sql.raw(table)} WHERE goal_id = ${goalId} AND workspace_id = ${w}`);
  }
  await tx.run(sql`DELETE FROM goals WHERE id = ${goalId} AND workspace_id = ${w}`);
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
  await database.transaction((tx) =>
    withGoalCapture(tx, { entity: 'goal_stage', id: stageId }, () =>
      tx.update(goalStages).set({ paidOn }).where(and(eq(goalStages.id, stageId), eq(goalStages.workspaceId, ws.workspaceId))),
    ),
  );
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
    if (!MONEY_SUBTYPES.includes(account.subtype)) {
      throw new GoalDbError('Only accounts that hold money can be set aside; a holding is tagged on each purchase instead');
    }
    // A pocket parent holds no money of its own (currency pockets, ruling I5): set aside on one of its pockets.
    if (await isPocketParentTx(tx, ws, input.accountId)) throw new GoalDbError('That account holds no money of its own. Set aside on one of its pockets.');
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
    markGoalDirtyTx(tx, input.goalId);
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
    markGoalDirtyTx(tx, goalId);
  });
}

/**
 * What goes to a goal each month by standing arrangement, changed on its own: the stages, the working behind them and
 * the note stay as they are, so a goal worked out by a calculator stays worked out.
 */
export async function setStandingMonthly(database: Database, ws: WorkspaceContext, goalId: string, amountMinor: number): Promise<void> {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) throw new GoalDbError('A monthly amount is a whole figure, nought or more');
  const [goal] = await database.db.select({ id: goals.id }).from(goals).where(and(eq(goals.id, goalId), eq(goals.workspaceId, ws.workspaceId)));
  if (!goal) throw new GoalDbError('Goal not found in this workspace');
  await database.transaction(async (tx) => {
    await tx.update(goals).set({ standingMonthlyMinor: amountMinor }).where(and(eq(goals.id, goalId), eq(goals.workspaceId, ws.workspaceId)));
    markGoalDirtyTx(tx, goalId);
  });
}

/**
 * Hands part of one goal's set-aside on an account to another goal, on the same account, in one go: the money does
 * not move, only which goal it waits for. Never more than the first goal has there.
 */
export async function moveSetAside(
  database: Database,
  ws: WorkspaceContext,
  input: { fromGoalId: string; toGoalId: string; accountId: string; amountMinor: number },
): Promise<void> {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new GoalDbError('Move an amount greater than zero');
  if (input.fromGoalId === input.toGoalId) throw new GoalDbError('Pick another goal to move it to');
  await database.transaction(async (tx) => {
    const [target] = await tx
      .select({ id: goals.id, status: goals.status })
      .from(goals)
      .where(and(eq(goals.id, input.toGoalId), eq(goals.workspaceId, ws.workspaceId)));
    if (!target || target.status === 'archived') throw new GoalDbError('Goal not found in this workspace');
    const [source] = await tx
      .select({ amountMinor: goalEarmarks.amountMinor })
      .from(goalEarmarks)
      .where(and(eq(goalEarmarks.goalId, input.fromGoalId), eq(goalEarmarks.accountId, input.accountId), eq(goalEarmarks.workspaceId, ws.workspaceId)));
    if (!source) throw new GoalDbError('Nothing is set aside for that goal in this account');
    if (input.amountMinor > source.amountMinor) throw new GoalDbError('That is more than is set aside there');
    const left = source.amountMinor - input.amountMinor;
    const where = and(eq(goalEarmarks.goalId, input.fromGoalId), eq(goalEarmarks.accountId, input.accountId), eq(goalEarmarks.workspaceId, ws.workspaceId));
    if (left === 0) await tx.delete(goalEarmarks).where(where);
    else await tx.update(goalEarmarks).set({ amountMinor: left }).where(where);
    await tx
      .insert(goalEarmarks)
      .values({ goalId: input.toGoalId, accountId: input.accountId, workspaceId: ws.workspaceId, amountMinor: input.amountMinor })
      .onConflictDoUpdate({ target: [goalEarmarks.goalId, goalEarmarks.accountId], set: { amountMinor: sql`${goalEarmarks.amountMinor} + ${input.amountMinor}` } });
    await recordContributionTx(tx, ws, input.fromGoalId, input.accountId, -input.amountMinor);
    await recordContributionTx(tx, ws, input.toGoalId, input.accountId, input.amountMinor);
    markGoalDirtyTx(tx, input.fromGoalId);
    markGoalDirtyTx(tx, input.toGoalId);
  });
}
