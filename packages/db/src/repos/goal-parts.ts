import type { GoalPart } from '@expanses/core';
import { sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Db } from '../database';

/*
 * A split trade's parts (0083), read and written by name: a database stopped before 0083 has no such table, and every
 * trade there has at most one goal. Asked once per handle; only a yes is kept.
 */
const partsTable = new WeakMap<object, boolean>();
export async function goalPartsTableExists(db: Db): Promise<boolean> {
  if (partsTable.get(db)) return true;
  const rows = await db.values<[number]>(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'trade_goal_parts'`);
  if (rows.length > 0) partsTable.set(db, true);
  return rows.length > 0;
}

/** Every split trade's parts in the workspace, by trade id, in the order they were written. */
export async function goalPartsByTradeTx(db: Db, ws: WorkspaceContext): Promise<Map<string, GoalPart[]>> {
  if (!(await goalPartsTableExists(db))) return new Map();
  const rows = await db.values<[string, string, number, number]>(
    sql`SELECT p.trade_id, p.goal_id, p.units_micro, p.money_minor FROM trade_goal_parts p
        JOIN investment_trades t ON t.id = p.trade_id WHERE t.workspace_id = ${ws.workspaceId} ORDER BY p.rowid`,
  );
  const out = new Map<string, GoalPart[]>();
  for (const [tradeId, goalId, unitsMicro, moneyMinor] of rows) {
    out.set(tradeId, [...(out.get(tradeId) ?? []), { goalId, unitsMicro: Number(unitsMicro), moneyMinor: Number(moneyMinor) }]);
  }
  return out;
}

/** Replaces a trade's parts: none leaves it with one goal or none, on `investment_trades.goal_id`. */
export async function writeGoalPartsTx(db: Db, tradeId: string, parts: readonly GoalPart[]): Promise<void> {
  if (!(await goalPartsTableExists(db))) {
    if (parts.length > 0) throw new Error('This copy of the data is from before a purchase could be split between goals. Open it once on an updated version.');
    return;
  }
  await db.run(sql`DELETE FROM trade_goal_parts WHERE trade_id = ${tradeId}`);
  for (const part of parts) {
    await db.run(sql`INSERT INTO trade_goal_parts (trade_id, goal_id, units_micro, money_minor) VALUES (${tradeId}, ${part.goalId}, ${part.unitsMicro}, ${part.moneyMinor})`);
  }
}
