import { MONTH_START_LAST, monthStartOf, type MonthStartDay } from '@expanses/core';
import { type SQL, sql } from 'drizzle-orm';
import type { Db } from '../database';
import { transactions } from '../schema';

/**
 * Whether migration 0044 has run on this database. Every read and write of bill_windows and bill_payments asks
 * first, so a database stopped at an older version keeps today's calendar-month behaviour. A positive answer is
 * remembered per handle; a negative one is not, since migrate() may run later on the same handle.
 */
const billTables = new WeakMap<Db, boolean>();

export async function billTablesExist(db: Db): Promise<boolean> {
  if (billTables.get(db)) return true;
  const rows = await db.values<[number]>(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'bill_payments'`);
  const exists = rows.length > 0;
  if (exists) billTables.set(db, true);
  return exists;
}

const pauseTables = new WeakMap<Db, boolean>();

/** Whether migration 0064 has run: without it no bill is ever paused, and pausing is refused. */
export async function billPausesExist(db: Db): Promise<boolean> {
  if (pauseTables.get(db)) return true;
  const rows = await db.values<[number]>(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'bill_pauses'`);
  const exists = rows.length > 0;
  if (exists) pauseTables.set(db, true);
  return exists;
}

export const BILL_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * The day a transaction counts on in a monthly spending figure. A bill payment made outside the month whose bill it
 * settles counts on that bill's out day in that month (clamped to the month's end); everything else, including a
 * bill paid inside its own month, counts on the day it happened. bill_payments is keyed by transaction, so this is
 * one row at most and never multiplies the entries it is asked about. A purchase merely linked to a month afterwards
 * (no template_id of its own) stays where it was spent.
 */
export const attributedOn = (startDay: MonthStartDay = 1): SQL => {
  // The bill's out day in its bill month, clamped to the month's end.
  const clamped = sql`min(date(bp.bill_month || '-01', '+' || (et.day_of_month - 1) || ' days'), date(bp.bill_month || '-01', '+1 month', '-1 day'))`;
  // With months from the last day, a bill not on the 31st that falls on its month's last day counts the day before:
  // inside the month its bill month counts in (`billCountedOn`, core), not on the first day of the next.
  const outDay =
    monthStartOf(startDay) === MONTH_START_LAST
      ? sql`(CASE WHEN et.day_of_month < 31 AND ${clamped} = date(bp.bill_month || '-01', '+1 month', '-1 day') THEN date(${clamped}, '-1 day') ELSE ${clamped} END)`
      : clamped;
  // Starting on the 1st, the month it was paid in is its calendar month — the test as it always was, word for word.
  // Otherwise ("Month starts on", 0118) the payment and the bill must fall in the same one of the workspace's months.
  const sameMonth =
    monthStartOf(startDay) === 1
      ? sql`bp.bill_month = substr(${transactions.occurredOn}, 1, 7)`
      : sql`${periodMonthSql(outDay, startDay)} = ${periodMonthSql(sql`${transactions.occurredOn}`, startDay)}`;
  return sql`COALESCE((
  SELECT CASE WHEN ${sameMonth} THEN NULL
    ELSE ${outDay} END
  FROM bill_payments bp JOIN expense_templates et ON et.id = bp.template_id
  WHERE bp.transaction_id = ${transactions.id}
    AND ${transactions.templateId} IS NOT NULL
), ${transactions.occurredOn})`;
};

/**
 * SQL for `periodMonthOf` (core, month-start.ts): the YYYY-MM month a date is counted in. From the 2nd to the 28th, the
 * day moved back to the month's start day lands in the month it started in (a month is at least 28 days, so it never
 * passes two), named by it — or by the next one from the 16th on. On the last day, a date is next month's only on its
 * month's last day.
 */
export function periodMonthSql(date: SQL, startDay: MonthStartDay): SQL {
  const day = monthStartOf(startDay);
  if (day === 1) return sql`substr(${date}, 1, 7)`;
  if (day === MONTH_START_LAST) return sql`strftime('%Y-%m', ${date}, '+1 day')`;
  const back = sql.raw(`'-${day - 1} days'`);
  return day >= 16 ? sql`strftime('%Y-%m', ${date}, ${back}, 'start of month', '+1 month')` : sql`strftime('%Y-%m', ${date}, ${back})`;
}
