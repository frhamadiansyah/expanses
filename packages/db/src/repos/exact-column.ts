import { sql } from 'drizzle-orm';
import type { Db } from '../database';

/*
 * `transactions.exact_hundredths` and `draft_transactions.exact_hundredths` (0068): the figure of an amount typed with
 * cents in a currency with no minor unit, in hundredths (12.500,30 → 1250030), beside the whole amount the ledger
 * keeps. Not declared on the drizzle tables, for the reason `day_order` is not (see day-order-column.ts): a database
 * stopped before 0068 could otherwise no longer post, list or queue at all. Read and written by name, only where it is.
 */

const known = new WeakMap<object, Set<string>>();

async function columnExists(db: Db, table: 'transactions' | 'draft_transactions'): Promise<boolean> {
  if (known.get(db)?.has(table)) return true;
  const rows = await db.values<[number]>(sql`SELECT 1 FROM pragma_table_info(${table}) WHERE name = 'exact_hundredths'`);
  if (rows.length === 0) return false;
  const seen = known.get(db) ?? new Set<string>();
  seen.add(table);
  known.set(db, seen);
  return true;
}

/** Whether this database has `transactions.exact_hundredths`. Once seen it is remembered: a column is never taken away. */
export function exactExists(db: Db): Promise<boolean> {
  return columnExists(db, 'transactions');
}

/** Whether this database has `draft_transactions.exact_hundredths`. */
export function draftExactExists(db: Db): Promise<boolean> {
  return columnExists(db, 'draft_transactions');
}

/** Whether `value` can be an exact figure at all: a positive whole number of hundredths. */
export function isExactFigure(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/**
 * Whether a whole amount is that exact figure rounded one way or the other: 12.501 and 12.500 both are for 12.500,30.
 * Which way is the caller's (up for money out, down for money in); either way the figure belongs to the amount.
 */
export function exactFits(magnitude: number, exact: number): boolean {
  const floor = Math.floor(exact / 100);
  const whole = Math.abs(magnitude);
  return whole === floor || whole === (exact % 100 === 0 ? floor : floor + 1);
}

/** A posting line with the kind of account it is on: what decides which line a figure with cents belongs to. */
export interface KindedLine {
  amountMinor: number;
  kind: string;
}

/**
 * Whether a posting can carry this exact figure: it has exactly one category line (an expense or an income) and that
 * line is the figure rounded. Decimals go on a single amount only, so a split, a transfer or a card payment never fits,
 * whatever its money side says.
 */
export function exactFitsPosting(lines: readonly KindedLine[], exact: number): boolean {
  const category = lines.filter((line) => line.kind === 'expense' || line.kind === 'income');
  return category.length === 1 && exactFits(category[0]!.amountMinor, exact);
}

/** The money a posting moves, as an edit compares it: what its debit lines add up to. */
export function debitTotal(lines: readonly { amountMinor: number }[]): number {
  return lines.reduce((sum, line) => (line.amountMinor > 0 ? sum + line.amountMinor : sum), 0);
}

/**
 * What a figure that did not come from the person typing it (one carried through an edit, sent by a peer, read from a
 * capture or a statement) can be stored as against these lines: itself when it is a positive figure with cents that
 * fits the posting, else nothing. Never refused: a stray figure must not cost a posting its money.
 */
export function exactOrNull(value: unknown, lines: readonly KindedLine[]): number | null {
  if (!isExactFigure(value) || value % 100 === 0) return null;
  return exactFitsPosting(lines, value) ? value : null;
}

/** Posting lines with the kind of the account each is on. */
export async function kindedLinesTx(db: Db, lines: readonly { accountId: string; amountMinor: number }[]): Promise<KindedLine[]> {
  const ids = [...new Set(lines.map((line) => line.accountId))];
  const kinds = new Map<string, string>();
  for (const id of ids) {
    const [row] = await db.values<[string]>(sql`SELECT kind FROM accounts WHERE id = ${id}`);
    if (row) kinds.set(id, row[0]);
  }
  return lines.map((line) => ({ amountMinor: line.amountMinor, kind: kinds.get(line.accountId) ?? '' }));
}

/** `exactOrNull` for posting lines that name their accounts. */
export async function exactForLinesTx(db: Db, value: unknown, lines: readonly { accountId: string; amountMinor: number }[]): Promise<number | null> {
  if (!isExactFigure(value) || value % 100 === 0) return null;
  return exactOrNull(value, await kindedLinesTx(db, lines));
}

/** `exactOrNull` against a posted transaction's own lines. */
export async function exactForTransactionTx(db: Db, value: unknown, transactionId: string): Promise<number | null> {
  if (!isExactFigure(value) || value % 100 === 0) return null;
  const rows = await db.values<[number, string]>(
    sql`SELECT e.amount_minor, a.kind FROM entries e JOIN accounts a ON a.id = e.account_id WHERE e.transaction_id = ${transactionId}`,
  );
  return exactOrNull(value, rows.map(([amountMinor, kind]) => ({ amountMinor: Number(amountMinor), kind })));
}
