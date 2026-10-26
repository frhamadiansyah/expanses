import { sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Db } from '../database';

/*
 * `sinking_funds` (0101): a yearly bill's saving. Read and written by name through raw SQL, like the other side tables,
 * so a database stopped before 0101 loses only the fund and never fails to save a bill. Local: it does not sync.
 */

export interface SinkingFundRow {
  billId: string;
  accountId: string;
  monthlyMinor: number;
  /** YYYY-MM the saving began. */
  startedMonth: string;
  extraMinor: number;
}

const seen = new WeakSet<object>();

export async function sinkingTableExists(db: Db): Promise<boolean> {
  if (seen.has(db)) return true;
  const rows = await db.values<[number]>(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sinking_funds'`);
  if (rows.length === 0) return false;
  seen.add(db);
  return true;
}

export async function listSinkingFunds(db: Db, ws: WorkspaceContext): Promise<SinkingFundRow[]> {
  if (!(await sinkingTableExists(db))) return [];
  const rows = await db.values<[string, string, number, string, number]>(
    sql`SELECT bill_id, account_id, monthly_minor, started_month, extra_minor FROM sinking_funds WHERE workspace_id = ${ws.workspaceId} ORDER BY created_at, bill_id`,
  );
  return rows.map(([billId, accountId, monthlyMinor, startedMonth, extraMinor]) => ({
    billId,
    accountId,
    monthlyMinor: Number(monthlyMinor),
    startedMonth,
    extraMinor: Number(extraMinor),
  }));
}

/** Starts a fund, or changes an existing one's account and monthly figure; its start and extras stay. */
export async function writeSinkingFund(
  db: Db,
  ws: WorkspaceContext,
  fund: { billId: string; accountId: string; monthlyMinor: number; startedMonth: string },
): Promise<void> {
  if (!(await sinkingTableExists(db))) return;
  await db.run(
    sql`INSERT INTO sinking_funds (bill_id, workspace_id, account_id, monthly_minor, started_month, extra_minor, created_at)
        VALUES (${fund.billId}, ${ws.workspaceId}, ${fund.accountId}, ${fund.monthlyMinor}, ${fund.startedMonth}, 0, ${new Date().toISOString()})
        ON CONFLICT (bill_id) DO UPDATE SET account_id = excluded.account_id, monthly_minor = excluded.monthly_minor`,
  );
}

/** Adds one-off money to a fund. */
export async function addSinkingExtra(db: Db, ws: WorkspaceContext, billId: string, amountMinor: number): Promise<void> {
  if (!(await sinkingTableExists(db))) return;
  await db.run(sql`UPDATE sinking_funds SET extra_minor = extra_minor + ${amountMinor} WHERE bill_id = ${billId} AND workspace_id = ${ws.workspaceId}`);
}

/** Releases a fund: its earmark is dropped. Nothing when the bill has none. */
export async function dropSinkingFund(db: Db, ws: WorkspaceContext, billId: string): Promise<void> {
  if (!(await sinkingTableExists(db))) return;
  await db.run(sql`DELETE FROM sinking_funds WHERE bill_id = ${billId} AND workspace_id = ${ws.workspaceId}`);
}

export async function getSinkingFund(db: Db, ws: WorkspaceContext, billId: string): Promise<SinkingFundRow | null> {
  return (await listSinkingFunds(db, ws)).find((fund) => fund.billId === billId) ?? null;
}
