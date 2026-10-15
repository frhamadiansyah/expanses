import { type ExpenseRecord, expenseInEvent, MoneyError, parseSplitJson, type SettlementRecord, SharedEventError } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { ownerScope, type WorkspaceContext } from '../context';
import type { Db } from '../database';
import { createAccountTx } from './accounts';

/*
 * A shared event's records as this phone holds them (shared events §3), read in one place for the derivation, the
 * screens and the relay book's rules alike. Peer data is read defensively: an expense whose detail has not arrived yet
 * reads as absent rather than as an expense nobody shares.
 */

export interface EventBookRow {
  bookId: string;
  workspaceId: string;
  baseCurrency: string;
  /** The local `events` row the event lists under. */
  eventId: string;
  /** The trip balance: an `event_balance` asset in the event currency. */
  balanceAccountId: string;
  /** This phone's member in the event's book — its person id (ruling R1). */
  me: string;
  /** `shared_books.state`: 'active', 'needs_invite' or 'unshared'. */
  state: string;
  name: string;
  startsOn: string;
  endsOn: string;
  currency: string;
  finishedAt: string | null;
}

export interface StoredExpense extends ExpenseRecord {
  occurredOn: string;
  payerMemberId: string | null;
  voidedAt: string | null;
  categoryId: string | null;
  note: string | null;
  recordedBy: string;
  updatedBy: string | null;
}

export interface StoredSettlement extends SettlementRecord {
  occurredOn: string;
  fromMemberId: string | null;
  toMemberId: string | null;
  voidedAt: string | null;
}

export interface StoredPerson {
  personId: string;
  name: string;
  memberId: string | null;
  removedAt: string | null;
}

type BookRowValues = [string, string, string, string, string, string, string | null, string | null, string | null, string | null, string | null, string];

/*
 * The event currency is the log's once the log has locked it (ruling R8): a change this phone made before it heard of
 * the first expense is not the currency any record was converted to, even before it is put back.
 */
const bookSelect = sql`
  SELECT e.book_id, e.workspace_id, w.base_currency, e.event_id, e.balance_account_id, s.member_id,
         se.name, se.starts_on, se.ends_on,
         coalesce(CASE WHEN lc.locked = 1 AND lc.currency <> '' THEN lc.currency END, se.currency),
         se.finished_at, s.state
  FROM event_books e
  JOIN workspaces w ON w.id = e.workspace_id
  JOIN shared_books s ON s.book_id = e.book_id
  LEFT JOIN shared_events se ON se.book_id = e.book_id
  LEFT JOIN event_log_currency lc ON lc.book_id = e.book_id`;

function bookRowOf(row: BookRowValues | undefined): EventBookRow | null {
  // Before the event's own row has arrived (a joiner mid-pull), there is no currency to post in: nothing yet.
  if (!row || row[6] === null || row[9] === null) return null;
  return {
    bookId: row[0],
    workspaceId: row[1],
    baseCurrency: row[2],
    eventId: row[3],
    balanceAccountId: row[4],
    me: row[5],
    name: row[6],
    startsOn: row[7] ?? '',
    endsOn: row[8] ?? '',
    currency: row[9],
    finishedAt: row[10],
    state: row[11],
  };
}

export async function eventBookTx(db: Db, bookId: string): Promise<EventBookRow | null> {
  const [row] = await db.values<BookRowValues>(sql`${bookSelect} WHERE e.book_id = ${bookId}`);
  return bookRowOf(row);
}

export async function eventBookOfEventTx(db: Db, eventId: string): Promise<EventBookRow | null> {
  const [row] = await db.values<BookRowValues>(sql`${bookSelect} WHERE e.event_id = ${eventId}`);
  return bookRowOf(row);
}

type ExpenseValues = [string, string, number, string, string, string, string | null, string | null, string | null, string | null, string, string, string, string | null];

const expenseSelect = sql`
  SELECT x.id, x.occurred_on, x.amount_minor, x.currency, x.rate_to_event, x.payer_person_id, x.payer_member_id, x.voided_at,
         d.note, d.category_id, d.split_mode, d.split_json, d.recorded_by, d.updated_by
  FROM event_expenses x JOIN event_expense_details d ON d.book_id = x.book_id AND d.id = x.id`;

function expenseOf(row: ExpenseValues): StoredExpense {
  const [id, occurredOn, amountMinor, currency, rateToEvent, payerPersonId, payerMemberId, voidedAt, note, categoryId, splitMode, splitJson, recordedBy, updatedBy] = row;
  return {
    id,
    occurredOn,
    amountMinor: Number(amountMinor),
    currency,
    rateToEvent,
    payerPersonId,
    payerMemberId,
    voidedAt,
    voided: voidedAt !== null,
    note,
    categoryId,
    split: parseSplitJson(splitMode, splitJson),
    recordedBy,
    updatedBy,
  };
}

/** One expense with its details, or null while either half is missing here. Throws `SharedEventError` on a split it cannot read. */
export async function expenseRecordTx(db: Db, bookId: string, id: string): Promise<StoredExpense | null> {
  const [row] = await db.values<ExpenseValues>(sql`${expenseSelect} WHERE x.book_id = ${bookId} AND x.id = ${id}`);
  return row ? expenseOf(row) : null;
}

type SettlementValues = [string, string, string, string, string | null, string | null, number, string | null];

const settlementSelect = sql`SELECT id, occurred_on, from_person_id, to_person_id, from_member_id, to_member_id, amount_minor, voided_at FROM event_settlements`;

function settlementOf([id, occurredOn, fromPersonId, toPersonId, fromMemberId, toMemberId, amountMinor, voidedAt]: SettlementValues): StoredSettlement {
  return { id, occurredOn, fromPersonId, toPersonId, fromMemberId, toMemberId, amountMinor: Number(amountMinor), voidedAt, voided: voidedAt !== null };
}

export async function settlementRecordTx(db: Db, bookId: string, id: string): Promise<StoredSettlement | null> {
  const [row] = await db.values<SettlementValues>(sql`${settlementSelect} WHERE book_id = ${bookId} AND id = ${id}`);
  return row ? settlementOf(row) : null;
}

/** An expense whose split this phone cannot read, with an empty split in its place and why. */
export interface UnparsedExpense {
  expense: StoredExpense;
  reason: string;
}

/**
 * Why an expense cannot be added up in the event currency (final review I2), or null when it can: a split that does not
 * add up to the amount (a friend's by-amount split racing the payer's new amount, both legal), a rate that is not one,
 * a rate other than 1 in the event currency. Such a record is left out of every figure and shown to be fixed; it never
 * takes the event page, the Debts page, Leave or Remove down with it.
 */
export function expenseReadIssue(expense: StoredExpense, eventCurrency: string): string | null {
  try {
    expenseInEvent(expense, eventCurrency);
    return null;
  } catch (error) {
    if (error instanceof SharedEventError || error instanceof MoneyError) return error.message;
    throw error;
  }
}

/**
 * Every record of the event here, oldest first, ties by id: the order every phone reads them in. An expense whose split
 * cannot be read at all is in `unparsed` (with an empty split), never silently dropped: it still names its payer, and
 * the page shows it to be fixed (I2).
 */
export async function eventRecordsTx(
  db: Db,
  bookId: string,
): Promise<{ expenses: StoredExpense[]; unparsed: UnparsedExpense[]; settlements: StoredSettlement[]; people: StoredPerson[] }> {
  const expenses: StoredExpense[] = [];
  const unparsed: UnparsedExpense[] = [];
  for (const row of await db.values<ExpenseValues>(sql`${expenseSelect} WHERE x.book_id = ${bookId} ORDER BY x.occurred_on, x.id`)) {
    try {
      expenses.push(expenseOf(row));
    } catch (error) {
      if (!(error instanceof SharedEventError)) throw error;
      unparsed.push({ expense: { ...expenseOf([...row.slice(0, 10), 'equal', '[]', ...row.slice(12)] as ExpenseValues) }, reason: error.message });
    }
  }
  const settlements = (await db.values<SettlementValues>(sql`${settlementSelect} WHERE book_id = ${bookId} ORDER BY occurred_on, id`)).map(settlementOf);
  const people = (
    await db.values<[string, string, string | null, string | null]>(sql`SELECT id, name, member_id, removed_at FROM event_people WHERE book_id = ${bookId} ORDER BY name, id`)
  ).map(([personId, name, memberId, removedAt]) => ({ personId, name, memberId, removedAt }));
  return { expenses, unparsed, settlements, people };
}

/**
 * Holds a shared event's book on this phone (shared events §5): its trip-balance account — an asset in the event
 * currency, named after the event — and the local record of which workspace and which `events` row it belongs to.
 * Written by the one who shares the event and by every joiner, never by a peer's op.
 */
export async function openEventBookTx(tx: Db, ws: WorkspaceContext, input: { bookId: string; eventId: string; name: string; currency: string }): Promise<string> {
  const account = await createAccountTx(tx, ownerScope(ws), { name: input.name, kind: 'asset', subtype: 'event_balance', currency: input.currency });
  await tx.run(sql`
    INSERT INTO event_books (book_id, workspace_id, event_id, balance_account_id) VALUES (${input.bookId}, ${ws.workspaceId}, ${input.eventId}, ${account.id})`);
  return account.id;
}
