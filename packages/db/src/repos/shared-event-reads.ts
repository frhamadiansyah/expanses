import { balances, expenseInEvent, fewestPayments, sharesOf, type SplitInput, type SuggestedPayment, toEvent } from '@expanses/core';
import { sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import type { ChangeSet } from '../sync/types';
import type { EventUnposted } from './shared-event-postings';
import { type EventBookRow, eventBookOfEventTx, eventRecordsTx } from './shared-event-records';

/*
 * What the screens read of a shared event (shared events §6, §7). Figures are in the event currency unless a field
 * says otherwise; "my" is this phone's person, named on every screen and never called "you".
 */

export function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
}

export function splitText(split: SplitInput): string {
  const count = split.mode === 'equal' ? split.people.length : split.shares.length;
  return `${split.mode === 'equal' ? 'Equal' : 'By amount'} · ${count} ${count === 1 ? 'person' : 'people'}`;
}

export interface SharedPersonView {
  personId: string;
  name: string;
  initials: string;
  hasApp: boolean;
  isMe: boolean;
  removed: boolean;
  balanceMinor: number;
}

export interface RecordPostingView {
  transactionId: string | null;
  unposted: EventUnposted | null;
  /** "Changed by Andi": who last changed the record when it was not this phone's person. */
  changedByName: string | null;
  /** The currency of the account this phone's person paid it from or received it into, when one is kept here (R5). */
  accountCurrency: string | null;
  /** That account, local to this phone (R5): the Add screen opens this person's own payment on it. */
  accountId?: string | null;
  /** What that account moved in its own currency, when that is not the record's (R5); null when it is. */
  accountAmountMinor?: number | null;
}

export interface SharedExpenseView {
  expenseId: string;
  occurredOn: string;
  amountMinor: number;
  currency: string;
  rateToEvent: string;
  eventAmountMinor: number;
  payerPersonId: string;
  payerName: string;
  /** Paid from an account in the app: its money is its payer's member's alone (D8). */
  payerHasAccount: boolean;
  categoryId: string | null;
  categoryName: string | null;
  note: string | null;
  split: SplitInput;
  splitText: string;
  /** This phone's person's share in the expense's own currency, and in the event currency. */
  myShareMinor: number;
  myShareEventMinor: number;
  voided: boolean;
  /** Still in this phone's outbox: "Not sent yet" (§7). */
  unsent: boolean;
  /** Its amount, currency, rate, date and delete are another member's alone. */
  payerOnly: boolean;
  posting: RecordPostingView | null;
}

export interface SharedSettlementView {
  settlementId: string;
  occurredOn: string;
  fromPersonId: string;
  fromName: string;
  toPersonId: string;
  toName: string;
  amountMinor: number;
  voided: boolean;
  unsent: boolean;
  /** This phone's person paid or received it. */
  mine: boolean;
  posting: RecordPostingView | null;
}

export interface NamedPayment extends SuggestedPayment {
  fromName: string;
  toName: string;
}

export interface SharedEventView {
  eventId: string;
  bookId: string;
  name: string;
  startsOn: string;
  endsOn: string;
  currency: string;
  finishedAt: string | null;
  state: string;
  me: string;
  myName: string;
  people: SharedPersonView[];
  categories: { categoryId: string; name: string; icon: string | null; archived: boolean }[];
  expenses: SharedExpenseView[];
  settlements: SharedSettlementView[];
  spentMinor: number;
  myShareMinor: number;
  payments: NamedPayment[];
  /** Records not in this phone's books, and why (R6). */
  waiting: { recordId: string; kind: 'expense' | 'settlement'; reason: EventUnposted }[];
  /** The currency can no longer change: something is spent. */
  currencyLocked: boolean;
}

/** The record ids whose ops still wait in this phone's outbox for the event's book. */
async function unsentIdsTx(db: Db, bookId: string): Promise<Set<string>> {
  const out = new Set<string>();
  for (const [json] of await db.values<[string]>(sql`SELECT entry_json FROM sync_outbox WHERE book_id = ${bookId}`)) {
    for (const op of (JSON.parse(json) as ChangeSet).ops) out.add(op.id);
  }
  return out;
}

async function postingsTx(db: Db, bookId: string, names: Map<string, string>): Promise<Map<string, RecordPostingView>> {
  const rows = await db.values<[string, string | null, string | null, string | null, string | null, string | null, number | null]>(sql`
    SELECT p.record_id, p.transaction_id, p.unposted, p.changed_by, a.currency, p.account_id, p.account_amount_minor
    FROM event_postings p LEFT JOIN accounts a ON a.id = p.account_id WHERE p.book_id = ${bookId}`);
  return new Map(
    rows.map(([id, transactionId, unposted, changedBy, accountCurrency, accountId, accountAmountMinor]) => [
      id,
      {
        transactionId,
        unposted: unposted as EventUnposted | null,
        changedByName: changedBy ? (names.get(changedBy) ?? null) : null,
        accountCurrency,
        accountId,
        accountAmountMinor: accountAmountMinor === null ? null : Number(accountAmountMinor),
      },
    ]),
  );
}

const named = (payments: SuggestedPayment[], names: Map<string, string>): NamedPayment[] =>
  payments.map((p) => ({ fromPersonId: p.fromPersonId, fromName: names.get(p.fromPersonId) ?? 'Someone', toPersonId: p.toPersonId, toName: names.get(p.toPersonId) ?? 'Someone', amountMinor: p.amountMinor }));

async function viewOfTx(db: Db, book: EventBookRow): Promise<SharedEventView> {
  const { expenses, settlements, people } = await eventRecordsTx(db, book.bookId);
  const names = new Map(people.map((p) => [p.personId, p.name]));
  const owed = balances(expenses, settlements, book.currency, people.map((p) => p.personId));
  const unsent = await unsentIdsTx(db, book.bookId);
  const postings = await postingsTx(db, book.bookId, names);
  const categories = (
    await db.values<[string, string, string | null, string | null]>(sql`SELECT id, name, icon, archived_at FROM event_categories WHERE book_id = ${book.bookId} ORDER BY sort_order, name`)
  ).map(([categoryId, name, icon, archivedAt]) => ({ categoryId, name, icon, archived: archivedAt !== null }));
  const categoryName = new Map(categories.map((c) => [c.categoryId, c.name]));
  let spentMinor = 0;
  let myShareMinor = 0;
  const expenseViews: SharedExpenseView[] = expenses.map((e) => {
    const { paidMinor } = expenseInEvent(e, book.currency);
    const mine = sharesOf(e).find((s) => s.personId === book.me)?.minor ?? 0;
    const mineInEvent = mine === 0 ? 0 : toEvent(mine, e.currency, e.rateToEvent, book.currency);
    if (!e.voided) {
      spentMinor += paidMinor;
      myShareMinor += mineInEvent;
    }
    return {
      expenseId: e.id,
      occurredOn: e.occurredOn,
      amountMinor: e.amountMinor,
      currency: e.currency,
      rateToEvent: e.rateToEvent,
      eventAmountMinor: paidMinor,
      payerPersonId: e.payerPersonId,
      payerName: names.get(e.payerPersonId) ?? 'Someone',
      payerHasAccount: e.payerMemberId !== null,
      categoryId: e.categoryId,
      categoryName: e.categoryId ? (categoryName.get(e.categoryId) ?? null) : null,
      note: e.note,
      split: e.split,
      splitText: splitText(e.split),
      myShareMinor: mine,
      myShareEventMinor: mineInEvent,
      voided: e.voided,
      unsent: unsent.has(e.id),
      payerOnly: e.payerMemberId !== null && e.payerMemberId !== book.me,
      posting: postings.get(e.id) ?? null,
    };
  });
  const settlementViews: SharedSettlementView[] = settlements.map((s) => ({
    settlementId: s.id,
    occurredOn: s.occurredOn,
    fromPersonId: s.fromPersonId,
    fromName: names.get(s.fromPersonId) ?? 'Someone',
    toPersonId: s.toPersonId,
    toName: names.get(s.toPersonId) ?? 'Someone',
    amountMinor: s.amountMinor,
    voided: s.voided,
    unsent: unsent.has(s.id),
    mine: s.fromPersonId === book.me || s.toPersonId === book.me,
    posting: postings.get(s.id) ?? null,
  }));
  const waiting = [...postings]
    .filter(([, p]) => p.unposted !== null)
    .map(([recordId, p]) => ({ recordId, kind: (expenses.some((e) => e.id === recordId) ? 'expense' : 'settlement') as 'expense' | 'settlement', reason: p.unposted! }));
  return {
    eventId: book.eventId,
    bookId: book.bookId,
    name: book.name,
    startsOn: book.startsOn,
    endsOn: book.endsOn,
    currency: book.currency,
    finishedAt: book.finishedAt,
    state: book.state,
    me: book.me,
    myName: names.get(book.me) ?? 'Someone',
    people: people.map((p) => ({ personId: p.personId, name: p.name, initials: initialsOf(p.name), hasApp: p.memberId !== null, isMe: p.personId === book.me, removed: p.removedAt !== null, balanceMinor: owed[p.personId] ?? 0 })),
    categories,
    expenses: expenseViews,
    settlements: settlementViews,
    spentMinor,
    myShareMinor,
    payments: named(fewestPayments(owed), names),
    waiting,
    currencyLocked: expenses.length > 0,
  };
}

export async function sharedEventView(database: Database, ws: WorkspaceContext, eventId: string): Promise<SharedEventView | null> {
  const book = await eventBookOfEventTx(database.db, eventId).catch(() => null);
  if (!book || book.workspaceId !== ws.workspaceId) return null;
  return viewOfTx(database.db, book);
}

export interface SharedEventSummary {
  eventId: string;
  /** The others in the event, by name: the initials the events list draws. */
  people: { name: string; initials: string }[];
  sharedWith: number;
}

/** Every shared event of this workspace, by its local event id, for the events list. */
export async function sharedEventSummaries(database: Database, ws: WorkspaceContext): Promise<Record<string, SharedEventSummary>> {
  const out: Record<string, SharedEventSummary> = {};
  const rows = await database.db.values<[string, string, string]>(sql`
    SELECT e.event_id, e.book_id, s.member_id FROM event_books e JOIN shared_books s ON s.book_id = e.book_id WHERE e.workspace_id = ${ws.workspaceId}`).catch(() => []);
  for (const [eventId, bookId, me] of rows) {
    const people = (
      await database.db.values<[string]>(sql`SELECT name FROM event_people WHERE book_id = ${bookId} AND id <> ${me} AND removed_at IS NULL ORDER BY name, id`)
    ).map(([name]) => ({ name, initials: initialsOf(name) }));
    out[eventId] = { eventId, people, sharedWith: people.length };
  }
  return out;
}

export interface EventBalanceRow {
  eventId: string;
  name: string;
  currency: string;
  /** The trip balance in this phone's books: positive, the group owes this person. */
  balanceMinor: number;
  /** The suggested payments this person is in. */
  payments: NamedPayment[];
}

/** The Debts page's trips (spec §5): each shared event with a balance here or a payment this person is in. */
export async function eventBalanceRows(database: Database, ws: WorkspaceContext): Promise<EventBalanceRow[]> {
  const out: EventBalanceRow[] = [];
  const events = await database.db.values<[string]>(sql`SELECT event_id FROM event_books WHERE workspace_id = ${ws.workspaceId}`).catch(() => []);
  for (const [eventId] of events) {
    const book = await eventBookOfEventTx(database.db, eventId);
    if (!book) continue;
    const view = await viewOfTx(database.db, book);
    const [held] = await database.db.values<[number]>(sql`
      SELECT coalesce(sum(e.amount_minor), 0) FROM entries e JOIN transactions t ON t.id = e.transaction_id
      WHERE e.account_id = ${book.balanceAccountId} AND t.status = 'posted'`);
    const payments = view.payments.filter((p) => p.fromPersonId === book.me || p.toPersonId === book.me);
    const balanceMinor = Number(held?.[0] ?? 0);
    if (balanceMinor !== 0 || payments.length > 0) out.push({ eventId, name: book.name, currency: book.currency, balanceMinor, payments });
  }
  return out;
}

/**
 * The shared event's record a transaction follows, for its receipt (§7 "Changed by"); null for any other transaction.
 * A derived transaction is changed on the event, never on its own, so the receipt sends Edit there and says who last
 * changed the record when it was not this phone's person.
 */
export async function eventPostingOf(
  database: Database,
  transactionId: string,
): Promise<{ eventId: string; kind: 'expense' | 'settlement'; recordId: string; changedByName: string | null } | null> {
  const [row] = await database.db
    .values<[string, string, string, string | null]>(sql`
      SELECT b.event_id, p.kind, p.record_id, (SELECT name FROM event_people WHERE book_id = p.book_id AND id = p.changed_by)
      FROM event_postings p JOIN event_books b ON b.book_id = p.book_id WHERE p.transaction_id = ${transactionId}`)
    // A copy stopped before migration 0069 has no shared events, and so no transaction that follows one.
    .catch(() => []);
  return row ? { eventId: row[0], kind: row[1] as 'expense' | 'settlement', recordId: row[2], changedByName: row[3] } : null;
}

/**
 * Every account that is a shared event's local copy of one of its categories (`event_category_accounts`): an expense
 * account filed in no book, which no workspace category picker may offer (§5.1). Empty on a copy stopped before 0069.
 */
export async function shareCategoryAccountIds(database: Database): Promise<string[]> {
  const rows = await database.db.values<[string]>(sql`SELECT account_id FROM event_category_accounts`).catch(() => []);
  return rows.map(([id]) => id);
}
