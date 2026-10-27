import { monthlyAt, type SinkingEntry, type SinkingFundFacts, uuidv7 } from '@expanses/core';
import { sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Db } from '../database';

/*
 * `sinking_funds` (0101) and `sinking_fund_entries` (0103): a yearly bill's saving and its history. Read and written by
 * name through raw SQL, like the other side tables, so a database stopped before them loses only the fund and never
 * fails to save a bill. Local: it does not sync. How the entries add up is core's bills/sinking.ts.
 */

export interface SinkingFundRow extends SinkingFundFacts {
  billId: string;
  accountId: string;
  /** The first plan's monthly figure (same as `monthlyMinor` here; a view overwrites `monthlyMinor` with the current one). */
  baseMonthlyMinor: number;
  /** True when the owner typed the monthly figure (a skip then leaves it alone). */
  custom: boolean;
  /**
   * The figure set aside each month from next month on. (`SinkingFundFacts.monthlyMinor` is the first plan's, in force
   * from the start; this is the latest.)
   */
  currentMonthlyMinor: number;
  /** A fund made under 0101 held its extras as one number on the row; read as one 'extra' entry inside `entries`. */
  legacyExtraMinor: number;
}

const seen = new WeakSet<object>();
const seenEntries = new WeakSet<object>();

async function tableExists(db: Db, name: string, cache: WeakSet<object>): Promise<boolean> {
  if (cache.has(db)) return true;
  const rows = await db.values<[number]>(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ${name}`);
  if (rows.length === 0) return false;
  cache.add(db);
  return true;
}

export const sinkingTableExists = (db: Db): Promise<boolean> => tableExists(db, 'sinking_funds', seen);
export const sinkingEntriesTableExists = (db: Db): Promise<boolean> => tableExists(db, 'sinking_fund_entries', seenEntries);

export async function listSinkingFunds(db: Db, ws: WorkspaceContext): Promise<SinkingFundRow[]> {
  if (!(await sinkingTableExists(db))) return [];
  const hasEntries = await sinkingEntriesTableExists(db);
  const rows = await db.values<[string, string, number, string, number, string, number]>(
    hasEntries
      ? sql`SELECT bill_id, account_id, monthly_minor, started_month, extra_minor, created_at, monthly_custom FROM sinking_funds WHERE workspace_id = ${ws.workspaceId} ORDER BY created_at, bill_id`
      : sql`SELECT bill_id, account_id, monthly_minor, started_month, extra_minor, created_at, 0 FROM sinking_funds WHERE workspace_id = ${ws.workspaceId} ORDER BY created_at, bill_id`,
  );
  const entries = new Map<string, SinkingEntry[]>();
  if (hasEntries) {
    const list = await db.values<[string, string, string, string | null, number, string]>(
      sql`SELECT id, bill_id, kind, month, amount_minor, occurred_on FROM sinking_fund_entries WHERE workspace_id = ${ws.workspaceId} ORDER BY occurred_on, created_at, id`,
    );
    for (const [id, billId, kind, month, amountMinor, occurredOn] of list) {
      const entry: SinkingEntry = { id, kind: kind as SinkingEntry['kind'], month, amountMinor: Number(amountMinor), occurredOn };
      entries.set(billId, [...(entries.get(billId) ?? []), entry]);
    }
  }
  return rows.map(([billId, accountId, monthlyMinor, startedMonth, extraMinor, createdAt, custom]) => {
    const own = entries.get(billId) ?? [];
    const legacy = Number(extraMinor);
    const all: SinkingEntry[] = legacy > 0 ? [{ id: 'legacy-extra', kind: 'extra', month: null, amountMinor: legacy, occurredOn: createdAt.slice(0, 10) }, ...own] : own;
    const facts: SinkingFundFacts = { monthlyMinor: Number(monthlyMinor), startedMonth, entries: all };
    return {
      ...facts,
      billId,
      accountId,
      baseMonthlyMinor: Number(monthlyMinor),
      custom: Number(custom) === 1,
      currentMonthlyMinor: monthlyAt(facts, '9999-12'),
      legacyExtraMinor: legacy,
    };
  });
}

/** Starts a fund, or changes an existing one's account and first monthly figure; its start and entries stay. */
export async function writeSinkingFund(
  db: Db,
  ws: WorkspaceContext,
  fund: { billId: string; accountId: string; monthlyMinor: number; startedMonth: string; custom?: boolean },
): Promise<void> {
  if (!(await sinkingTableExists(db))) return;
  const custom = fund.custom ? 1 : 0;
  const hasEntries = await sinkingEntriesTableExists(db);
  if (hasEntries) {
    await db.run(
      sql`INSERT INTO sinking_funds (bill_id, workspace_id, account_id, monthly_minor, started_month, extra_minor, created_at, monthly_custom)
          VALUES (${fund.billId}, ${ws.workspaceId}, ${fund.accountId}, ${fund.monthlyMinor}, ${fund.startedMonth}, 0, ${new Date().toISOString()}, ${custom})
          ON CONFLICT (bill_id) DO UPDATE SET account_id = excluded.account_id, monthly_minor = excluded.monthly_minor, monthly_custom = excluded.monthly_custom`,
    );
    return;
  }
  await db.run(
    sql`INSERT INTO sinking_funds (bill_id, workspace_id, account_id, monthly_minor, started_month, extra_minor, created_at)
        VALUES (${fund.billId}, ${ws.workspaceId}, ${fund.accountId}, ${fund.monthlyMinor}, ${fund.startedMonth}, 0, ${new Date().toISOString()})
        ON CONFLICT (bill_id) DO UPDATE SET account_id = excluded.account_id, monthly_minor = excluded.monthly_minor`,
  );
}

async function insertEntry(db: Db, ws: WorkspaceContext, billId: string, entry: { kind: SinkingEntry['kind']; month: string | null; amountMinor: number; occurredOn: string }): Promise<void> {
  if (!(await sinkingEntriesTableExists(db))) return;
  await db.run(
    sql`INSERT INTO sinking_fund_entries (id, bill_id, workspace_id, kind, month, amount_minor, occurred_on, created_at)
        VALUES (${uuidv7()}, ${billId}, ${ws.workspaceId}, ${entry.kind}, ${entry.month}, ${entry.amountMinor}, ${entry.occurredOn}, ${new Date().toISOString()})`,
  );
}

/** Adds one-off money to a fund, dated. (The free-money check and the recalculation are `putInSinkingExtra`'s.) */
export async function addSinkingExtra(db: Db, ws: WorkspaceContext, billId: string, amountMinor: number, occurredOn: string = new Date().toISOString().slice(0, 10)): Promise<void> {
  if (!(await sinkingTableExists(db))) return;
  if (!(await sinkingEntriesTableExists(db))) {
    await db.run(sql`UPDATE sinking_funds SET extra_minor = extra_minor + ${amountMinor} WHERE bill_id = ${billId} AND workspace_id = ${ws.workspaceId}`);
    return;
  }
  await insertEntry(db, ws, billId, { kind: 'extra', month: null, amountMinor, occurredOn });
}

/** Moves a fund to another account; its start, plans and entries stay. */
export async function moveSinkingFund(db: Db, ws: WorkspaceContext, billId: string, accountId: string): Promise<void> {
  if (!(await sinkingTableExists(db))) return;
  await db.run(sql`UPDATE sinking_funds SET account_id = ${accountId} WHERE bill_id = ${billId} AND workspace_id = ${ws.workspaceId}`);
}

/** Sets 'Already saved': replaces the opening entry; zero or null removes it. */
export async function writeSinkingOpening(db: Db, ws: WorkspaceContext, billId: string, amountMinor: number | null, occurredOn: string): Promise<void> {
  if (!(await sinkingEntriesTableExists(db))) return;
  await db.run(sql`DELETE FROM sinking_fund_entries WHERE bill_id = ${billId} AND workspace_id = ${ws.workspaceId} AND kind = 'opening'`);
  if (amountMinor && amountMinor > 0) await insertEntry(db, ws, billId, { kind: 'opening', month: null, amountMinor, occurredOn });
}

/** The monthly figure from `from` on. Plans from that month or later are replaced; earlier months keep what they added. */
export async function writeSinkingPlan(db: Db, ws: WorkspaceContext, billId: string, from: string, monthlyMinor: number, custom: boolean | null, today: string): Promise<void> {
  if (!(await sinkingEntriesTableExists(db))) return;
  await db.run(sql`DELETE FROM sinking_fund_entries WHERE bill_id = ${billId} AND workspace_id = ${ws.workspaceId} AND kind = 'plan' AND month >= ${from}`);
  await insertEntry(db, ws, billId, { kind: 'plan', month: from, amountMinor: monthlyMinor, occurredOn: today });
  if (custom !== null) await setSinkingCustom(db, ws, billId, custom);
}

export async function setSinkingCustom(db: Db, ws: WorkspaceContext, billId: string, custom: boolean): Promise<void> {
  if (!(await sinkingEntriesTableExists(db))) return;
  await db.run(sql`UPDATE sinking_funds SET monthly_custom = ${custom ? 1 : 0} WHERE bill_id = ${billId} AND workspace_id = ${ws.workspaceId}`);
}

/** Skips a month (adds nothing) or adds it again. */
export async function setSinkingSkip(db: Db, ws: WorkspaceContext, billId: string, month: string, skipped: boolean, today: string): Promise<void> {
  if (!(await sinkingEntriesTableExists(db))) return;
  await db.run(sql`DELETE FROM sinking_fund_entries WHERE bill_id = ${billId} AND workspace_id = ${ws.workspaceId} AND kind = 'skip' AND month = ${month}`);
  if (skipped) await insertEntry(db, ws, billId, { kind: 'skip', month, amountMinor: 0, occurredOn: today });
}

/** Releases a fund: its earmark is dropped, and its entries with it. Nothing when the bill has none. */
export async function dropSinkingFund(db: Db, ws: WorkspaceContext, billId: string): Promise<void> {
  if (!(await sinkingTableExists(db))) return;
  await db.run(sql`DELETE FROM sinking_funds WHERE bill_id = ${billId} AND workspace_id = ${ws.workspaceId}`);
  if (await sinkingEntriesTableExists(db)) await db.run(sql`DELETE FROM sinking_fund_entries WHERE bill_id = ${billId} AND workspace_id = ${ws.workspaceId}`);
}

export async function getSinkingFund(db: Db, ws: WorkspaceContext, billId: string): Promise<SinkingFundRow | null> {
  return (await listSinkingFunds(db, ws)).find((fund) => fund.billId === billId) ?? null;
}
