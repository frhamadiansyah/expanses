import { feeLeftOut, isoDate } from '@expanses/core';
import { notInArray, type SQL, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import { type Database, replacementsOf } from '../database';
import { transactions } from '../schema';
import { cardFeeYears, type FeeYearRecord, mayBeFeeMoneyBack } from './card-fee';
import { feeFieldsByCard } from './fee-columns';

/*
 * A reversed fee is left out (owner, 22 Nov 2026, option 1 of docs/mockups/2026-11-22-fee-same-everywhere.html): once
 * money back for a year's annual fee is on the card, the fee charge and the money back both leave every report — the
 * chart, the month totals, budgets, Health, Income, categories, events — as if the fee was never charged. Each card is
 * read as its Fee waiver page reads it (`cardFeeYears`), and core's `feeLeftOut` says which transactions go.
 *
 * It is worked out, never stored: nothing is written to a transaction, so there is nothing to backfill, nothing for
 * sync to carry or an older app to refuse, no mark left behind when the money back is deleted, Reset or voided, and
 * the owner's own "exclude" mark is never touched. Balances, statements and points never read it.
 */

/** Each database's answer, per workspace, with what it was worked out from. */
const remembered = new WeakMap<Database, Map<string, { key: string; ids: Promise<ReadonlySet<string>> }>>();

/**
 * What the answer was worked out from: every row change on this database (SQLite's own count, which any write moves),
 * a restore under it, and the day (the fee year a card covers turns with it). The same key is the same rows.
 */
async function stateKey(database: Database): Promise<string> {
  const [row] = await database.db.values<[number]>(sql`SELECT total_changes()`);
  return `${replacementsOf(database)}:${Number(row?.[0] ?? 0)}:${isoDate()}`;
}

/**
 * The transactions a reversed annual fee leaves out of the workspace's reports: each fee's charge and its money back.
 * Worked out once until anything is written: a page that adds up several figures pays for it once.
 */
export async function feeLeftOutIds(database: Database, ws: WorkspaceContext): Promise<ReadonlySet<string>> {
  const key = await stateKey(database);
  let byWorkspace = remembered.get(database);
  if (!byWorkspace) {
    byWorkspace = new Map();
    remembered.set(database, byWorkspace);
  }
  const seen = byWorkspace.get(ws.workspaceId);
  if (seen && seen.key === key) return seen.ids;
  const ids = workOut(database, ws).catch((error: unknown) => {
    // A failed read is never remembered: the next figure asks again.
    byWorkspace.delete(ws.workspaceId);
    throw error;
  });
  byWorkspace.set(ws.workspaceId, { key, ids });
  return ids;
}

async function workOut(database: Database, ws: WorkspaceContext): Promise<ReadonlySet<string>> {
  const db = database.db;
  const cards = [...(await feeFieldsByCard(db, ws)).entries()].filter(([, fields]) => fields.annualFeeOn !== null).map(([id]) => id);
  if (cards.length === 0) return new Set();
  // Only a card with a credit that could be money back for its fee is read year by year: most cards have none.
  const credits = await db.values<[string, string, string | null, string]>(sql`
    SELECT DISTINCT e.account_id, t.description, ca.system_key, ca.kind
    FROM entries e
    JOIN transactions t ON t.id = e.transaction_id AND t.status = 'posted'
    JOIN entries ce ON ce.transaction_id = t.id AND ce.account_id != e.account_id AND ce.amount_minor < 0
    JOIN accounts ca ON ca.id = ce.account_id AND ca.kind IN ('expense', 'income')
    WHERE e.workspace_id = ${ws.workspaceId} AND e.amount_minor > 0 AND e.account_id IN ${cards}`);
  const read = new Set(credits.filter(([, description, systemKey, kind]) => mayBeFeeMoneyBack(description, systemKey, kind)).map(([cardId]) => cardId));
  if (read.size === 0) return new Set();

  const today = isoDate();
  const records: FeeYearRecord[] = [];
  for (const cardId of read) {
    const years = await cardFeeYears(db, ws, { cardId, today });
    if (years) records.push(years.current, ...years.earlier);
  }
  const named = records.filter((record) => record.reversal !== null);
  if (named.length === 0) return new Set();

  // How many category lines each charge and money back holds: a fee inside a split stays as it is.
  const ids = [...new Set(named.flatMap((record) => [record.reversal!.transactionId, ...(record.charge ? [record.charge.transactionId] : [])]))];
  const lines = new Map(
    (
      await db.values<[string, number]>(sql`
        SELECT e.transaction_id, COUNT(*) FROM entries e JOIN accounts a ON a.id = e.account_id
        WHERE e.transaction_id IN ${ids} AND a.kind IN ('expense', 'income')
        GROUP BY e.transaction_id`)
    ).map(([id, count]) => [id, Number(count)]),
  );
  const split = (id: string) => (lines.get(id) ?? 0) > 1;
  const out = new Set<string>();
  for (const record of named) {
    const charge = record.charge ? { ...record.charge, split: split(record.charge.transactionId) } : null;
    const reversal = { ...record.reversal!, split: split(record.reversal!.transactionId) };
    for (const id of feeLeftOut({ charge, reversal })) out.add(id);
  }
  return out;
}

/**
 * Beside `notExcluded`: the where clause that leaves a reversed fee's charge and money back out of a report's rows.
 * Nothing (no clause) when no fee is left out.
 */
export async function notFeeLeftOut(database: Database, ws: WorkspaceContext): Promise<SQL[]> {
  const ids = await feeLeftOutIds(database, ws);
  return ids.size > 0 ? [notInArray(transactions.id, [...ids])] : [];
}
