import { type SQL, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Db } from '../database';

/*
 * `expense_templates.repeat_every` (0102) is the same kind of column: the gap in months of a bill that repeats every few months
 * (repeat = 'months', repeat_month = the month of its first occurrence). Old builds read an unknown repeat as monthly.
 *
 * `expense_templates.repeat` and `.repeat_month` (0099): a bill that comes out once a year, in that month. Null while it
 * repeats every month, which is every bill made before. Not declared on the drizzle table, for the reason `currency` is
 * not (see bill-currency.ts): a drizzle insert names every declared column, so a database stopped before 0099 could no
 * longer save a bill at all. Read and written by name, and only where the columns are.
 */

const seen = new WeakSet<object>();
const everySeen = new WeakSet<object>();

/** Whether this database has the columns. Once seen it is remembered: a column is never taken away. */
export async function billRepeatExists(db: Db): Promise<boolean> {
  if (seen.has(db)) return true;
  const rows = await db.values<[number]>(sql`SELECT 1 FROM pragma_table_info('expense_templates') WHERE name = 'repeat_month'`);
  if (rows.length === 0) return false;
  seen.add(db);
  return true;
}

/** Whether this database has `repeat_every` (0102). A database stopped at 0099-0101 still saves yearly bills. */
async function billRepeatEveryExists(db: Db): Promise<boolean> {
  if (everySeen.has(db)) return true;
  const rows = await db.values<[number]>(sql`SELECT 1 FROM pragma_table_info('expense_templates') WHERE name = 'repeat_every'`);
  if (rows.length === 0) return false;
  everySeen.add(db);
  return true;
}

export interface BillRepeatFacts {
  /** 'yearly' or 'months'; a monthly bill is not in the map. */
  repeat: 'yearly' | 'months';
  /** 1-12: a yearly bill's month, or the month an every-few-months bill's first occurrence falls in. */
  month: number;
  /** The gap in months for 'months'; null for yearly. */
  every: number | null;
}

/** Each non-monthly bill's repeat by id; a monthly bill is not in the map. */
export async function billRepeats(db: Db, ws: WorkspaceContext): Promise<Map<string, BillRepeatFacts>> {
  if (!(await billRepeatExists(db))) return new Map();
  const hasEvery = await billRepeatEveryExists(db);
  const rows = await db.values<[string, string, number, number | null]>(
    hasEvery
      ? sql`SELECT id, repeat, repeat_month, repeat_every FROM expense_templates WHERE workspace_id = ${ws.workspaceId} AND repeat IN ('yearly', 'months') AND repeat_month BETWEEN 1 AND 12`
      : sql`SELECT id, repeat, repeat_month, NULL FROM expense_templates WHERE workspace_id = ${ws.workspaceId} AND repeat = 'yearly' AND repeat_month BETWEEN 1 AND 12`,
  );
  const map = new Map<string, BillRepeatFacts>();
  for (const [id, repeat, month, every] of rows) {
    // A 'months' bill without a usable gap reads as monthly rather than guessing one.
    if (repeat === 'months' && !(every != null && Number(every) >= 2 && Number(every) <= 11)) continue;
    map.set(id, { repeat: repeat === 'months' ? 'months' : 'yearly', month: Number(month), every: repeat === 'months' ? Number(every) : null });
  }
  return map;
}

/** Sets how a bill repeats; null for every month. Nothing on a database without the columns. */
export async function writeBillRepeat(db: Db, ws: WorkspaceContext, id: string, facts: BillRepeatFacts | null): Promise<void> {
  if (!(await billRepeatExists(db))) return;
  await db.run(
    sql`UPDATE expense_templates SET repeat = ${facts?.repeat ?? null}, repeat_month = ${facts?.month ?? null} WHERE id = ${id} AND workspace_id = ${ws.workspaceId}`,
  );
  if (await billRepeatEveryExists(db)) {
    await db.run(sql`UPDATE expense_templates SET repeat_every = ${facts?.every ?? null} WHERE id = ${id} AND workspace_id = ${ws.workspaceId}`);
  }
}

/**
 * Whether this database can say which purchases paid a bill that is not monthly: a payment is one when its
 * `bill_payments` row (0044: a Pay, or a purchase linked to a bill's month afterwards) names a bill whose repeat is
 * 'yearly' (0099), or 'months' with `repeat_every` 2 or more (0102). All of these sync in a shared workspace (`bill`'s
 * optional `repeat`, `repeatMonth`, `repeatEvery`; `bill_payment`), so a partner's payment reads the same here as on
 * the phone that paid it.
 */
export async function notMonthlyBillsReadable(db: Db): Promise<boolean> {
  const rows = await db.values<[number]>(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'bill_payments'`);
  return rows.length > 0 && (await billRepeatExists(db));
}

/**
 * The purchases that paid a bill that is not monthly, as a subquery of transaction ids — `isNotMonthlyRepeat`
 * (@expanses/core) in SQL: yearly, or every 2 months or more. A database stopped at 0099-0101 has no every-few-months
 * bills, only yearly ones. Ask `notMonthlyBillsReadable` first.
 */
export async function notMonthlyBillPaymentIds(db: Db): Promise<SQL> {
  const everyFew = await billRepeatEveryExists(db);
  const notMonthly = (alias: string) =>
    sql.raw(everyFew ? `COALESCE(${alias}.repeat = 'yearly' OR (${alias}.repeat = 'months' AND ${alias}.repeat_every >= 2), 0)` : `COALESCE(${alias}.repeat = 'yearly', 0)`);
  // One payment of several bills (0127) is a not-monthly one only when every bill it settles is: paid with a monthly
  // bill, it is that month's spending too.
  const every = (cond: (alias: string) => SQL) =>
    sql`SELECT bp.transaction_id FROM bill_payments bp JOIN expense_templates et ON et.id = bp.template_id WHERE ${cond('et')}
      AND NOT EXISTS (SELECT 1 FROM bill_payments obp JOIN expense_templates oet ON oet.id = obp.template_id WHERE obp.transaction_id = bp.transaction_id AND NOT ${cond('oet')})`;
  return every(notMonthly);
}

/** Of these purchases, the ones that paid a bill that is not monthly. Empty on a database that cannot say. */
export async function notMonthlyBillPaymentsOf(db: Db, transactionIds: readonly string[]): Promise<Set<string>> {
  if (transactionIds.length === 0 || !(await notMonthlyBillsReadable(db))) return new Set();
  const rows = await db.values<[string]>(sql`${await notMonthlyBillPaymentIds(db)} AND bp.transaction_id IN ${transactionIds}`);
  return new Set(rows.map((row) => row[0]));
}
