import { uuidv7 } from '@expanses/core';
import { type SQL, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Db } from '../database';
import { GoalDbError } from './goals';

/** Every local table that names a goal by id (as `deleteGoal` lists them), and the column it names it in. */
const GOAL_COLUMNS: readonly [table: string, column: string][] = [
  ['goal_earmarks', 'goal_id'],
  ['goal_contributions', 'goal_id'],
  ['goal_draws', 'goal_id'],
  ['goal_calculators', 'goal_id'],
  ['goal_stage_terms', 'goal_id'],
  ['trade_goal_parts', 'goal_id'],
  ['investment_trades', 'goal_id'],
  ['trade_templates', 'goal_id'],
  ['asset_sales', 'goal_id'],
  ['transactions', 'goal_id'],
  ['events', 'goal_id'],
  ['goal_share_log', 'goal_id'],
  ['goal_dues', 'goal_id'],
  ['goal_due_months', 'goal_id'],
];

/** Every local table that names a stage by id. goal_member_moves names one too, but its lines of the old goal go. */
const STAGE_COLUMNS: readonly [table: string, column: string][] = [
  ['goal_draws', 'stage_id'],
  ['goal_stage_terms', 'stage_id'],
];

export interface RekeyGoalOptions {
  /** The shared goal's id, kept on the log line so the copy can say where it came from (C30). */
  copiedFrom?: string;
  /** The History line the copy starts with: "No longer shared by Bima", or a share that ended. */
  logLine?: { kind: 'unshared' | 'ended'; memberName: string; occurredOn: string };
}

/**
 * Turns a goal into a private copy under new ids (spec C30, D7): the goal and each stage get new uuidv7 ids, and every
 * local row naming them follows, so set-asides, contributions, draws, tagged buys, templates and History stay as they
 * were and no figure changes. If the sharer shares again, the shared goal arrives under its old id beside this copy
 * instead of colliding with it. The other members' lines of the old id go (this phone's own are worked out again).
 *
 * Runs inside the caller's transaction, with capture suspended or paused: it must emit nothing. Plain SQL throughout,
 * so a table an older database lacks reads as none, as `goalHasFunding` does.
 */
export async function rekeyGoalTx(tx: Db, ws: WorkspaceContext, goalId: string, opts: RekeyGoalOptions = {}): Promise<{ goalId: string; stageIds: Record<string, string> }> {
  const found = await tx.values<[number]>(sql`SELECT 1 FROM goals WHERE id = ${goalId} AND workspace_id = ${ws.workspaceId}`);
  if (found.length === 0) throw new GoalDbError('Goal not found in this workspace');
  const tables = new Set((await tx.values<[string]>(sql`SELECT name FROM sqlite_master WHERE type = 'table'`)).map((row) => row[0]));

  // The copies go in first and the old rows out last: goal_stages, goal_earmarks, investment_trades, trade_templates
  // and transactions reference goals(id), so the new goal must exist before anything points at it.
  const copy = uuidv7();
  await copyRow(tx, 'goals', sql`id = ${goalId}`, { id: copy });
  const stages = await tx.values<[string]>(sql`SELECT id FROM goal_stages WHERE goal_id = ${goalId} ORDER BY sort, due_on, id`);
  const stageIds: Record<string, string> = {};
  for (const [oldId] of stages) {
    const newId = uuidv7();
    stageIds[oldId] = newId;
    await copyRow(tx, 'goal_stages', sql`id = ${oldId}`, { id: newId, goal_id: copy });
  }

  for (const [table, column] of GOAL_COLUMNS) {
    if (!tables.has(table)) continue;
    await tx.run(sql`UPDATE ${sql.raw(table)} SET ${sql.raw(column)} = ${copy} WHERE ${sql.raw(column)} = ${goalId}`);
  }
  for (const [oldId, newId] of Object.entries(stageIds)) {
    for (const [table, column] of STAGE_COLUMNS) {
      if (!tables.has(table)) continue;
      await tx.run(sql`UPDATE ${sql.raw(table)} SET ${sql.raw(column)} = ${newId} WHERE ${sql.raw(column)} = ${oldId}`);
    }
  }

  // The members' lines of the shared goal go with it. goal_shares and goal_share_leaves stay: they describe the
  // sharer's goal, which keeps its id.
  if (tables.has('goal_member_funding')) await tx.run(sql`DELETE FROM goal_member_funding WHERE goal_id = ${goalId}`);
  if (tables.has('goal_member_moves')) await tx.run(sql`DELETE FROM goal_member_moves WHERE goal_id = ${goalId}`);
  await tx.run(sql`DELETE FROM goal_stages WHERE goal_id = ${goalId}`);
  await tx.run(sql`DELETE FROM goals WHERE id = ${goalId}`);

  if (opts.logLine && tables.has('goal_share_log')) {
    const { kind, memberName, occurredOn } = opts.logLine;
    await tx.run(
      sql`INSERT INTO goal_share_log (id, workspace_id, goal_id, kind, member_name, amount_minor, copied_from, occurred_on)
          VALUES (${uuidv7()}, ${ws.workspaceId}, ${copy}, ${kind}, ${memberName}, NULL, ${opts.copiedFrom ?? null}, ${occurredOn})`,
    );
  }
  return { goalId: copy, stageIds };
}

/**
 * Inserts a copy of one row with some columns replaced, every other column carried as it is. The columns are read from
 * the table itself, so one a later migration adds is copied too, and one an older database lacks is not asked for.
 */
async function copyRow(tx: Db, table: string, where: SQL, replace: Record<string, string>): Promise<void> {
  const columns = (await tx.values<[string]>(sql`SELECT name FROM pragma_table_info(${table})`)).map((row) => row[0]);
  const names = sql.raw(columns.map((column) => `"${column}"`).join(', '));
  const values = sql.join(
    columns.map((column) => (column in replace ? sql`${replace[column]}` : sql.raw(`"${column}"`))),
    sql`, `,
  );
  await tx.run(sql`INSERT INTO ${sql.raw(table)} (${names}) SELECT ${values} FROM ${sql.raw(table)} WHERE ${where}`);
}
